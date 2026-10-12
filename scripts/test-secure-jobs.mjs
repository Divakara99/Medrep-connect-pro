import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const freeId = '11111111-1111-4111-8111-111111111111'
const paidId = '22222222-2222-4222-8222-222222222222'

try {
  // Isolated Postgres instance with the same RLS boundary as schema.sql. Only
  // request.jwt.claim.sub is emulated; production Supabase verifies the JWT.
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.user_accounts (user_id uuid PRIMARY KEY, subscribed_until timestamptz);
    CREATE TABLE public.vacancies (id text PRIMARY KEY, data jsonb NOT NULL, synced_at timestamptz DEFAULT now());
    CREATE VIEW public.vacancies_view WITH (security_invoker = true) AS SELECT id, data FROM public.vacancies;
    ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object(
        'app_metadata', jsonb_build_object('role', CASE WHEN current_setting('test.admin', true) = 'true' THEN 'admin' ELSE 'user' END),
        'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1')
      )
    $$;
    CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE POLICY legacy_exposed ON public.vacancies FOR SELECT TO authenticated USING (true);
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.vacancies TO authenticated;
    INSERT INTO public.user_accounts VALUES
      ('${freeId}', NULL), ('${paidId}', now() + interval '1 day');
    INSERT INTO public.vacancies (id, data) VALUES
      ('job_1', '{"title":"Medical Representative","location":"Chennai","category":"MR","salary":"2 LPA","experience":"0-2 years","company":"Hidden Pharma","manager":"Private Manager","contact":"9999999999","managerEmail":"private@example.org","description":"Private description","postedAt":123,"pinned":true}'),
      ('removed', '{"deleted":true,"title":"Removed","location":"Chennai","category":"MR"}');
  `)
  const migration = await readFile(new URL('../supabase/secure_jobs.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.exec(migration) // Repeatable migration must preserve the same policy.

  const { rows: [grants] } = await db.query(`SELECT
    has_function_privilege('anon', 'public.list_visible_jobs()', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.list_visible_jobs()', 'EXECUTE') AS signed_in`)
  assert.equal(grants.anon, false, 'anon must not execute the jobs RPC')
  assert.equal(grants.signed_in, true)

  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${freeId}'`)
  const { rows: [raw] } = await db.query('SELECT count(*)::int AS count FROM public.vacancies')
  assert.equal(raw.count, 0, 'direct JSONB table SELECT must remain admin-only')
  const { rows: [rawView] } = await db.query('SELECT count(*)::int AS count FROM public.vacancies_view')
  assert.equal(rawView.count, 0, 'security-invoker view must not leak raw jobs')
  await db.exec("SET test.admin = 'true'")
  const { rows: [aal1Rows] } = await db.query('SELECT count(*)::int AS count FROM public.vacancies')
  assert.equal(aal1Rows.count, 0, 'password-only admin must be denied by RLS')
  const blockedWrite = await db.query("UPDATE public.vacancies SET synced_at = now() WHERE id = 'job_1'")
  assert.equal(blockedWrite.affectedRows, 0, 'password-only admin must not update raw vacancies')
  await db.exec("SET test.aal = 'aal2'")
  const { rows: [adminRows] } = await db.query('SELECT count(*)::int AS count FROM public.vacancies')
  assert.equal(adminRows.count, 2, 'trusted admins must retain raw vacancy access')
  await db.exec("SET test.admin = 'false'")
  const { rows: free } = await db.query('SELECT * FROM public.list_visible_jobs()')
  assert.equal(free.length, 1, 'deleted rows must not be listed')
  const freeJob = free[0].list_visible_jobs
  assert.equal(freeJob.title, 'Medical Representative')
  // The city and the public description stay visible before any subscription.
  assert.equal(freeJob.location, 'Chennai', 'city must stay visible to free users')
  assert.equal(freeJob.description, 'Private description', 'description is public and must be readable')
  // Confidential fields must not exist in the free-user response at all.
  for (const field of ['company', 'manager', 'contact', 'managerEmail', 'managerAltPhone', 'hq', 'division']) {
    assert.equal(Object.hasOwn(freeJob, field), false, `${field} leaked to free user`)
  }

  // The public description must not become a back door for contact details.
  // Re-run as a fully verified (role + aal2) admin, which is the only identity
  // allowed to write vacancies at all.
  await db.exec("SET test.admin = 'true'; SET test.aal = 'aal2'")
  await assert.rejects(
    db.query(`INSERT INTO public.vacancies (id, data) VALUES
      ('leaky_email', '{"title":"MR","location":"Chennai","category":"MR","description":"Call hr@hiddenpharma.example"}')`),
    /description is public/,
    'emails in the public description must be rejected',
  )
  await assert.rejects(
    db.query(`INSERT INTO public.vacancies (id, data) VALUES
      ('leaky_phone', '{"title":"MR","location":"Chennai","category":"MR","description":"Contact +91 98765 43210 for details"}')`),
    /description is public/,
    'phone numbers in the public description must be rejected',
  )
  await assert.rejects(
    db.query(`UPDATE public.vacancies SET data = data || '{"description":"Email hr@x.co.in"}' WHERE id = 'job_1'`),
    /description is public/,
    'updates must be guarded too',
  )
  const { rows: [guarded] } = await db.query(`
    UPDATE public.vacancies
    SET data = data || '{"description":"Field sales\\nDoctor calls\\n25k incentive"}'
    WHERE id = 'job_1' RETURNING data ->> 'description' AS description`)
  assert.match(guarded.description, /Doctor calls/, 'ordinary point-wise descriptions must still save')
  await db.exec("SET test.admin = 'false'; SET test.aal = 'aal1'")

  await db.exec(`SET request.jwt.claim.sub = '${paidId}'`)
  const { rows: paid } = await db.query('SELECT * FROM public.list_visible_jobs()')
  assert.equal(paid[0].list_visible_jobs.company, 'Hidden Pharma')
  assert.equal(paid[0].list_visible_jobs.contact, '9999999999')

  await db.exec(`RESET ROLE; UPDATE public.user_accounts SET subscribed_until = now() - interval '1 second' WHERE user_id = '${paidId}'; SET ROLE authenticated`)
  const { rows: expired } = await db.query('SELECT * FROM public.list_visible_jobs()')
  assert.equal(Object.hasOwn(expired[0].list_visible_jobs, 'contact'), false, 'expired access must be revoked by server')

  await db.exec("SET request.jwt.claim.sub = ''; SET ROLE anon")
  await assert.rejects(db.query('SELECT * FROM public.list_visible_jobs()'), /permission denied/)
  console.log('secure jobs SQL: free, paid, expired, admin-only raw table, deleted and anon checks passed')
} finally {
  await db.close()
}
