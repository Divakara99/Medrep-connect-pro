import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

/**
 * Vacancy team checks (supabase/vacancy_team.sql):
 *   - a vacancy_editor login can post and delete vacancies, nothing else
 *   - a delete needs a reason; the reason is stored in the audit log
 *   - the team cannot read the raw vacancy table, the audit log or team logins
 *   - admin adds and deletes are audited too, with the reason (or a marker)
 *   - the audit log is readable only by an MFA-verified administrator
 *   - the migration backfills earlier vacancies once, and is safe to re-run
 */
const db = new PGlite()
const adminId = '33333333-3333-4333-8333-333333333333'
const teamId = '44444444-4444-4444-8444-444444444444'
const userId = '11111111-1111-4111-8111-111111111111'

async function as({ id = '', role = 'user', email = '', aal = 'aal1' }) {
  await db.exec(`RESET ROLE; SET ROLE authenticated;
    SET request.jwt.claim.sub = '${id}';
    SET test.role = '${role}';
    SET test.email = '${email}';
    SET test.aal = '${aal}';`)
}
const asTeam = () => as({ id: teamId, role: 'vacancy_editor', email: 'team@example.org' })
const asAdmin = () => as({ id: adminId, role: 'admin', email: 'admin@example.org', aal: 'aal2' })
const asAdminNoMfa = () => as({ id: adminId, role: 'admin', email: 'admin@example.org', aal: 'aal1' })
const asUser = () => as({ id: userId, role: 'user', email: 'user@example.org' })

async function rejects(promise, pattern) {
  let error = null
  try { await promise } catch (cause) { error = cause }
  assert.ok(error, `expected an error matching ${pattern}`)
  assert.match(error.message, pattern)
}

const fields = (overrides = {}) => ({
  title: 'Medical Representative',
  company: 'Acme Pharma',
  location: 'Bengaluru',
  category: 'MR',
  description: 'Field sales in the assigned territory',
  salary: '2 LPA',
  experience: '0-2 years',
  qualification: 'B.Pharm',
  ageLimit: 'Below 30 years',
  vacancyCount: '1 position',
  ...overrides,
})

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    INSERT INTO auth.users (id, email) VALUES
      ('${adminId}', 'admin@example.org'),
      ('${teamId}', 'team@example.org'),
      ('${userId}', 'user@example.org');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object(
        'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
        'email', nullif(current_setting('test.email', true), ''),
        'app_metadata', jsonb_build_object('role', nullif(current_setting('test.role', true), '')),
        'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1')
      )
    $$;
    -- Same trusted-role + verified-TOTP rule as admin_mfa.sql.
    CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
         AND coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
    $$;

    -- Stand-ins for schema.sql / secure_jobs.sql. The real description guard is
    -- tested in test-description-guard.mjs; this one only proves the trigger
    -- still runs when the team posts through the function.
    CREATE TABLE public.vacancies (id text PRIMARY KEY, data jsonb NOT NULL, synced_at timestamptz DEFAULT now());
    CREATE TABLE public.notifications (id text PRIMARY KEY, data jsonb NOT NULL, synced_at timestamptz DEFAULT now());
    ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
    CREATE POLICY authenticated_admin_all ON public.vacancies FOR ALL TO authenticated
      USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY authenticated_admin_all ON public.notifications FOR ALL TO authenticated
      USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
    CREATE FUNCTION public.vacancy_public_description_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF coalesce(NEW.data ->> 'description', '') LIKE '%@%' THEN
        RAISE EXCEPTION 'The job description is public. Remove the email address.' USING ERRCODE = '22023';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER vacancy_public_description_guard BEFORE INSERT OR UPDATE ON public.vacancies
      FOR EACH ROW EXECUTE FUNCTION public.vacancy_public_description_guard();
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.vacancies TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), public.is_app_admin() TO authenticated;

    -- Vacancies that exist before tracking began: one live, one already deleted.
    INSERT INTO public.vacancies (id, data) VALUES
      ('old-live', '{"title":"ABM Territory","company":"Old Co","location":"Pune","category":"ABM","postedAt":1700000000000}'),
      ('old-gone', '{"title":"Retired Role","company":"Old Co","location":"Delhi","category":"MR","deleted":true,"deletedAt":1710000000000}');
  `)

  const migration = await readFile(new URL('../supabase/vacancy_team.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.exec(migration) // Re-running must not duplicate the backfill or change rules.
  const duplicateMigration = await readFile(new URL('../supabase/vacancy_duplicate_check.sql', import.meta.url), 'utf8')
  await db.exec(duplicateMigration)
  await db.exec(duplicateMigration) // The new RPC and field projections are repeatable.

  // 1. Backfill: earlier vacancies are counted once, labelled 'earlier'.
  await asAdmin()
  let rows = (await db.query(`SELECT action, vacancy_id, actor_role, reason FROM public.vacancy_audit ORDER BY id`)).rows
  assert.equal(rows.filter((r) => r.action === 'added' && r.actor_role === 'earlier').length, 2)
  assert.equal(rows.filter((r) => r.action === 'deleted' && r.actor_role === 'earlier').length, 1)
  assert.equal(rows.find((r) => r.action === 'deleted').reason, 'Deleted before activity tracking began')

  // 2. The team can post. The function validates, inserts, and notifies users.
  await asTeam()
  const posted = (await db.query(
    `SELECT public.employee_post_vacancy($1::jsonb) AS job`,
    [JSON.stringify(fields({ contact: '+91 98765 43210', managerEmail: 'hr@acme.example' }))],
  )).rows[0].job
  assert.match(posted.id, /^[0-9a-f-]{36}$/)
  assert.equal(posted.title, 'Medical Representative')
  await asAdmin() // the raw table is admin-only; check what was written
  const stored = (await db.query(`SELECT data FROM public.vacancies WHERE id = $1`, [posted.id])).rows[0].data
  assert.equal(stored.postedBy, 'team@example.org')
  assert.equal(stored.pinned, false, 'the team cannot pin vacancies')
  assert.equal(stored.qualification, 'B.Pharm')
  assert.equal(stored.ageLimit, 'Below 30 years')
  assert.equal(stored.vacancyCount, '1 position')
  const notice = (await db.query(`SELECT data FROM public.notifications WHERE data->'meta'->>'jobId' = $1`, [posted.id])).rows
  assert.equal(notice.length, 1, 'a team post notifies users once')
  assert.equal(notice[0].data.target, 'all')
  assert.equal(notice[0].data.type, 'job')
  await asTeam()

  // The team can compare only through the role-checked RPC. The exact result
  // contains a public summary, never contacts or the public description text.
  const exactDuplicate = (await db.query(
    `SELECT public.check_vacancy_duplicates($1::jsonb, NULL) AS result`,
    [JSON.stringify(fields())],
  )).rows[0].result
  assert.equal(exactDuplicate.status, 'exact')
  assert.equal(exactDuplicate.matches[0].id, posted.id)
  for (const privateField of ['contact', 'manager', 'managerEmail', 'description']) {
    assert.equal(Object.hasOwn(exactDuplicate.matches[0], privateField), false, `${privateField} must not leak in duplicate results`)
  }
  const possibleDuplicate = (await db.query(
    `SELECT public.check_vacancy_duplicates($1::jsonb, NULL) AS result`,
    [JSON.stringify(fields({ qualification: '' }))],
  )).rows[0].result
  assert.equal(possibleDuplicate.status, 'possible', 'missing optional details are labelled possible, not exact')
  assert.equal(possibleDuplicate.matches[0].matchType, 'possible')
  const differentVacancy = (await db.query(
    `SELECT public.check_vacancy_duplicates($1::jsonb, NULL) AS result`,
    [JSON.stringify(fields({ salary: '5 LPA' }))],
  )).rows[0].result
  assert.equal(differentVacancy.status, 'none', 'a conflicting salary does not count as a duplicate')
  const excluded = (await db.query(
    `SELECT public.check_vacancy_duplicates($1::jsonb, $2::text) AS result`,
    [JSON.stringify(fields()), posted.id],
  )).rows[0].result
  assert.equal(excluded.status, 'none', 'editing excludes its own row from duplicate checks')

  // Legacy active records may not have the newly optional qualification yet;
  // keep them as possible matches instead of claiming there are none.
  await asAdmin()
  await db.query(`UPDATE public.vacancies SET data = data || '{"qualification":""}' WHERE id = $1`, [posted.id])
  await asTeam()
  const legacyPossible = (await db.query(
    `SELECT public.check_vacancy_duplicates($1::jsonb, NULL) AS result`,
    [JSON.stringify(fields())],
  )).rows[0].result
  assert.equal(legacyPossible.status, 'possible')
  assert.equal(legacyPossible.matches[0].id, posted.id)

  await asAdminNoMfa()
  await rejects(db.query(`SELECT public.check_vacancy_duplicates($1::jsonb, NULL)`, [JSON.stringify(fields())]), /Only an administrator or vacancy employee/)
  await asUser()
  await rejects(db.query(`SELECT public.check_vacancy_duplicates($1::jsonb, NULL)`, [JSON.stringify(fields())]), /Only an administrator or vacancy employee/)
  await asTeam()

  // 3. Validation and the shared description guard still apply.
  await rejects(db.query(`SELECT public.employee_post_vacancy($1::jsonb)`, [JSON.stringify(fields({ title: 'x' }))]), /title of 2 to 120/)
  await rejects(db.query(`SELECT public.employee_post_vacancy($1::jsonb)`, [JSON.stringify(fields({ category: 'Sales' }))]), /valid category/)
  await rejects(db.query(`SELECT public.employee_post_vacancy($1::jsonb)`, [JSON.stringify(fields({ description: 'mail hr@acme.example' }))]), /Remove the email/)

  // 4. The team has no direct table access.
  await asTeam()
  assert.equal((await db.query(`SELECT id FROM public.vacancies`)).rows.length, 0, 'RLS hides the raw table')
  await rejects(db.query(`INSERT INTO public.vacancies (id, data) VALUES ('sneaky', '{"title":"Direct"}')`), /row-level security/)
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.vacancy_audit`)).rows[0].n, 0, 'RLS hides the audit log')
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.vacancy_employees`)).rows[0].n, 0)
  await rejects(db.query(`INSERT INTO public.vacancy_audit (action, vacancy_id, actor_role) VALUES ('deleted', 'x', 'admin')`), /permission denied/)

  // 5. Listing returns only what the team needs. No contact or description fields.
  const listed = (await db.query(`SELECT public.employee_list_vacancies() AS job`)).rows.map((r) => r.job)
  assert.ok(listed.some((job) => job.id === posted.id))
  for (const job of listed) {
    assert.deepEqual(Object.keys(job).sort(), ['ageLimit', 'category', 'company', 'id', 'location', 'postedAt', 'postedBy', 'qualification', 'title', 'vacancyCount'])
  }

  // 6. Delete needs a real reason. A deleted vacancy cannot be deleted again.
  await rejects(db.query(`SELECT public.employee_delete_vacancy($1, $2)`, [posted.id, '  ']), /reason/)
  await db.query(`SELECT public.employee_delete_vacancy($1, $2)`, [posted.id, 'Position filled by another agency'])
  await rejects(db.query(`SELECT public.employee_delete_vacancy($1, $2)`, [posted.id, 'Position filled again']), /already deleted/)
  assert.ok(!(await db.query(`SELECT public.employee_list_vacancies() AS job`)).rows.some((r) => r.job.id === posted.id))

  // 7. Admin can post and delete, and both are audited. Missing reasons are recorded as such.
  await asAdmin()
  await db.query(`INSERT INTO public.vacancies (id, data) VALUES ('admin-new', '{"title":"Admin Post","company":"Admin Co","location":"Mumbai","category":"Finance"}')`)
  await db.query(`UPDATE public.vacancies SET data = '{"deleted":true,"deletedAt":1720000000000}' WHERE id = 'admin-new'`)
  await db.query(`UPDATE public.vacancies SET data = data || '{"deleted":true,"deletedAt":1720000000001,"deleteReason":"Duplicate entry"}' WHERE id = 'old-live'`)

  // 8. Admin reads the whole activity log. Actor, reason and title are all present.
  rows = (await db.query(`SELECT action, vacancy_id, title, actor_role, actor_email, reason FROM public.vacancy_audit ORDER BY id`)).rows
  const teamAdded = rows.find((r) => r.action === 'added' && r.vacancy_id === posted.id)
  assert.deepEqual([teamAdded.actor_role, teamAdded.actor_email], ['vacancy_editor', 'team@example.org'])
  const teamDeleted = rows.find((r) => r.action === 'deleted' && r.vacancy_id === posted.id)
  assert.equal(teamDeleted.reason, 'Position filled by another agency')
  assert.equal(teamDeleted.title, 'Medical Representative', 'title is kept after the tombstone')
  assert.equal(teamDeleted.actor_role, 'vacancy_editor')
  const adminAdded = rows.find((r) => r.action === 'added' && r.vacancy_id === 'admin-new')
  assert.deepEqual([adminAdded.actor_role, adminAdded.actor_email], ['admin', 'admin@example.org'])
  const adminDeleted = rows.find((r) => r.action === 'deleted' && r.vacancy_id === 'admin-new')
  assert.equal(adminDeleted.reason, 'No reason recorded')
  const adminReasoned = rows.find((r) => r.action === 'deleted' && r.vacancy_id === 'old-live')
  assert.equal(adminReasoned.reason, 'Duplicate entry')
  assert.equal(adminReasoned.actor_role, 'admin')

  // 9. Totals: 2 earlier adds + team add + admin add + earlier delete + 3 new deletes.
  const totals = (await db.query(`SELECT
      count(*) FILTER (WHERE action = 'added')::int AS added,
      count(*) FILTER (WHERE action = 'deleted')::int AS deleted
    FROM public.vacancy_audit`)).rows[0]
  assert.deepEqual(totals, { added: 4, deleted: 4 })

  // 10. An administrator without MFA sees nothing, and the team cannot edit history.
  await asAdminNoMfa()
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.vacancy_audit`)).rows[0].n, 0)
  await rejects(db.query(`UPDATE public.vacancy_audit SET reason = 'changed'`), /permission denied/)

  // 11. Only the vacancy_editor role can use the team functions; a normal user cannot.
  await asUser()
  await rejects(db.query(`SELECT public.employee_post_vacancy($1::jsonb)`, [JSON.stringify(fields())]), /vacancy team account/)
  await rejects(db.query(`SELECT public.employee_list_vacancies()`), /vacancy team account/)
  await rejects(db.query(`SELECT public.employee_delete_vacancy($1, $2)`, ['old-live', 'Some reason']), /vacancy team account/)

  // 12. Only one employee login at a time. The database refuses a second one;
  //     deleting the first makes room for a replacement.
  await db.exec(`RESET ROLE`)
  const firstEmployee = '55555555-5555-4555-8555-555555555555'
  const secondEmployee = '66666666-6666-4666-8666-666666666666'
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'first@example.org'), ($2, 'second@example.org')`, [firstEmployee, secondEmployee])
  await db.query(`INSERT INTO public.vacancy_employees (user_id, email, name) VALUES ($1, 'first@example.org', 'First Employee')`, [firstEmployee])
  await rejects(
    db.query(`INSERT INTO public.vacancy_employees (user_id, email, name) VALUES ($1, 'second@example.org', 'Second Employee')`, [secondEmployee]),
    /vacancy_employees_single_login|duplicate key/,
  )
  await db.query(`DELETE FROM public.vacancy_employees WHERE user_id = $1`, [firstEmployee])
  await db.query(`INSERT INTO public.vacancy_employees (user_id, email, name) VALUES ($1, 'second@example.org', 'Second Employee')`, [secondEmployee])
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.vacancy_employees`)).rows[0].n, 1, 'exactly one employee login')

  console.log('vacancy SQL: role-scoped exact/possible duplicate checks with safe summaries, optional public fields, team post/delete, audit and isolation, MFA gating, single employee login and idempotent migrations passed')
} finally {
  await db.close()
}
