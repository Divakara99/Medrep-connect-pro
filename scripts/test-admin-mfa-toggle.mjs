import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

/**
 * Administrator sign-in code switch (supabase/admin_mfa.sql).
 *
 * The switch is the one place where the platform can run without a second
 * factor, so it is verified against the REAL migration:
 *   - the default is ON: a password-only (aal1) admin session gets nothing
 *   - with the switch ON, only an aal2 session counts as an administrator
 *   - an administrator can turn it OFF (server side, audited), and from then on
 *     a password-only admin session is accepted
 *   - a non-admin can never flip it, and never gains admin data either way
 *   - turning it back ON locks aal1 out again immediately
 *   - anonymous callers cannot call any of it
 */
const db = new PGlite()
const adminId = '11111111-1111-4111-8111-111111111111'
const otherAdminId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    INSERT INTO auth.users (id, email) VALUES
      ('${adminId}', 'owner@example.org'),
      ('${otherAdminId}', 'second-admin@example.org'),
      ('${userId}', 'jobseeker@example.org');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT jsonb_build_object(
        'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
        'email', coalesce((SELECT u.email FROM auth.users u WHERE u.id::text = current_setting('request.jwt.claim.sub', true)), ''),
        'app_metadata', jsonb_build_object('role', CASE WHEN current_setting('test.admin', true) = 'true' THEN 'admin' ELSE 'user' END),
        'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1')
      )
    $$;
    -- Admin-only data, guarded exactly like the real tables.
    CREATE TABLE public.vacancies (id text PRIMARY KEY, data jsonb NOT NULL);
    ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO authenticated, anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.vacancies TO authenticated;
  `)

  const migration = await readFile(new URL('../supabase/admin_mfa.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.exec(migration) // Repeatable migration must keep the same state.

  // The policy that protects admin data is defined here, after the function.
  await db.exec(`
    DROP POLICY IF EXISTS admin_only ON public.vacancies;
    CREATE POLICY admin_only ON public.vacancies FOR ALL TO authenticated
      USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
    INSERT INTO public.vacancies (id, data) VALUES ('job_1', '{"title":"MR"}'::jsonb);
  `)

  const { rows: [privileges] } = await db.query(`SELECT
    has_function_privilege('anon', 'public.is_app_admin()', 'EXECUTE') AS anon_is_admin,
    has_function_privilege('anon', 'public.set_admin_mfa_required(boolean)', 'EXECUTE') AS anon_toggle,
    has_function_privilege('authenticated', 'public.set_admin_mfa_required(boolean)', 'EXECUTE') AS user_toggle,
    has_table_privilege('authenticated', 'public.app_settings', 'SELECT') AS read_settings,
    has_function_privilege('authenticated', 'public.admin_mfa_required()', 'EXECUTE') AS read_flag`)
  assert.equal(privileges.anon_is_admin, false)
  assert.equal(privileges.anon_toggle, false, 'anonymous visitors must not be able to flip the switch')
  assert.equal(privileges.user_toggle, true, 'the function itself must check the role')
  assert.equal(privileges.read_settings, false, 'the settings table stays internal')
  assert.equal(privileges.read_flag, true)

  // ---- Default state: the code is ON ----
  const { rows: [initial] } = await db.query('SELECT public.admin_mfa_required() AS required')
  assert.equal(initial.required, true, 'a project that never touched the switch must require the code')

  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${adminId}'; SET test.admin = 'true'; SET test.aal = 'aal1'`)
  const { rows: [lockedAdmin] } = await db.query('SELECT public.is_app_admin() AS allowed')
  assert.equal(lockedAdmin.allowed, false, 'password-only admin must be refused while the code is ON')
  const { rows: lockedRows } = await db.query('SELECT count(*)::int AS count FROM public.vacancies')
  assert.equal(lockedRows[0].count, 0, 'password-only admin must not read admin data')

  let toggleRefused = false
  try {
    await db.query('SELECT public.set_admin_mfa_required(false)')
  } catch (error) {
    toggleRefused = /Only an administrator/.test(error instanceof Error ? error.message : String(error))
  }
  assert.equal(toggleRefused, true, 'a password-only session must not be able to switch the code off')

  await db.exec("SET test.aal = 'aal2'")
  const { rows: [verifiedAdmin] } = await db.query('SELECT public.is_app_admin() AS allowed')
  assert.equal(verifiedAdmin.allowed, true, 'a verified code session is an administrator')
  const { rows: verifiedRows } = await db.query('SELECT count(*)::int AS count FROM public.vacancies')
  assert.equal(verifiedRows[0].count, 1)

  // ---- Switch OFF (audited) ----
  const { rows: [toggled] } = await db.query('SELECT public.set_admin_mfa_required(false) AS state')
  assert.equal(toggled.state.mfaRequired, false)
  assert.equal(toggled.state.changedBy, 'owner@example.org', 'the audit must record who changed it')

  await db.exec("SET test.aal = 'aal1'")
  const { rows: [passwordOnly] } = await db.query('SELECT public.is_app_admin() AS allowed')
  assert.equal(passwordOnly.allowed, true, 'with the code OFF a password-only admin session is accepted')
  const { rows: readRows } = await db.query('SELECT count(*)::int AS count FROM public.vacancies')
  assert.equal(readRows[0].count, 1, 'and can read admin data')

  // A normal user is unaffected by the switch.
  await db.exec(`SET request.jwt.claim.sub = '${userId}'; SET test.admin = 'false'; SET test.aal = 'aal2'`)
  const { rows: [normalUser] } = await db.query('SELECT public.is_app_admin() AS allowed')
  assert.equal(normalUser.allowed, false, 'a normal user never becomes an administrator')
  const { rows: normalRows } = await db.query('SELECT count(*)::int AS count FROM public.vacancies')
  assert.equal(normalRows[0].count, 0)
  let userToggleRefused = false
  try {
    await db.query('SELECT public.set_admin_mfa_required(false)')
  } catch (error) {
    userToggleRefused = /Only an administrator/.test(error instanceof Error ? error.message : String(error))
  }
  assert.equal(userToggleRefused, true, 'a normal user must not be able to switch the admin code off')

  // ---- Back ON, from the password-only admin session that is allowed while OFF ----
  await db.exec(`SET request.jwt.claim.sub = '${adminId}'; SET test.admin = 'true'; SET test.aal = 'aal1'`)
  const { rows: [reEnabled] } = await db.query('SELECT public.set_admin_mfa_required(true) AS state')
  assert.equal(reEnabled.state.mfaRequired, true)
  const { rows: [relocked] } = await db.query('SELECT public.is_app_admin() AS allowed')
  assert.equal(relocked.allowed, false, 'turning the code back ON locks the password-only session out again')

  const { rows: [session] } = await db.query('SELECT public.current_admin_session() AS session')
  assert.equal(session.session.mfaRequired, true)
  assert.equal(session.session.mfaVerified, false)
  assert.equal(session.session.isAdmin, false)
  assert.equal(session.session.aal, 'aal1')

  // ---- Audit trail: readable by administrators only ----
  // (The switch is ON again, so reading it requires a verified code session.)
  await db.exec("SET test.aal = 'aal2'")
  const { rows: [audit] } = await db.query(
    'SELECT count(*)::int AS total FROM public.app_settings_audit WHERE key = \'admin_mfa\'',
  )
  assert.equal(audit.total, 2, 'every switch change is recorded')
  const { rows: [auditDetail] } = await db.query(
    'SELECT changed_by, changed_aal FROM public.app_settings_audit ORDER BY id ASC LIMIT 1',
  )
  assert.equal(auditDetail.changed_by, 'owner@example.org')
  assert.equal(auditDetail.changed_aal, 'aal2', 'the code state of the person changing it is recorded')
  await db.exec(`SET request.jwt.claim.sub = '${userId}'; SET test.admin = 'false'`)
  const { rows: userAudit } = await db.query('SELECT count(*)::int AS total FROM public.app_settings_audit')
  assert.equal(userAudit[0].total, 0, 'the audit trail is admin-only')

  // ---- Anonymous callers ----
  await db.exec('RESET ROLE; SET ROLE anon')
  await assert.rejects(
    db.query('SELECT public.set_admin_mfa_required(false)'),
    /permission denied/i,
    'anonymous visitors cannot reach the switch',
  )
  await db.exec('RESET ROLE')

  // ---- Fail safe: a damaged row must not silently disable the code ----
  await db.exec(`INSERT INTO public.app_settings (key, value) VALUES ('admin_mfa', '{}'::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = '{}'::jsonb`)
  const { rows: [malformed] } = await db.query('SELECT public.admin_mfa_required() AS required')
  assert.equal(malformed.required, true, 'an unreadable setting must count as "code required"')

  console.log('admin code switch SQL: default ON, audited OFF, role-gated, fail-safe and reversible passed')
} finally {
  await db.close()
}
