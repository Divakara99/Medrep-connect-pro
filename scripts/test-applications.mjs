import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

/**
 * Application record checks:
 *   - a signed-in user can file their own application
 *   - the identity on the row comes from the verified token, never the browser
 *   - a user cannot read (or hide) somebody else's applications
 *   - an administrator can still review every application
 */
const db = new PGlite()
const applicantId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const adminId = '33333333-3333-4333-8333-333333333333'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    INSERT INTO auth.users (id, email) VALUES
      ('${applicantId}', 'applicant@example.org'),
      ('${otherId}', 'other@example.org'),
      ('${adminId}', 'admin@example.org');
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
    CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
         AND coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
    $$;
    CREATE TABLE public.applications (
      id text PRIMARY KEY, data jsonb NOT NULL, synced_at timestamptz DEFAULT now()
    );
    ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY admin_only ON public.applications FOR ALL TO authenticated
      USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), public.is_app_admin() TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.applications TO authenticated;
  `)

  const migration = await readFile(new URL('../supabase/applications.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.exec(migration) // Repeatable migration must keep the same grants.

  const { rows: [grants] } = await db.query(`SELECT
    has_function_privilege('anon', 'public.record_application(jsonb)', 'EXECUTE') AS anon_record,
    has_function_privilege('anon', 'public.list_my_applications()', 'EXECUTE') AS anon_list`)
  assert.equal(grants.anon_record, false)
  assert.equal(grants.anon_list, false)

  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${applicantId}'`)

  // A signed-in user cannot write the raw admin-only table directly.
  await assert.rejects(
    db.query(`INSERT INTO public.applications (id, data) VALUES ('raw', '{}'::jsonb)`),
    /row-level security/,
    'the raw applications table must stay admin-only',
  )

  // The browser's claimed identity is replaced by the verified token claims.
  const { rows: [recorded] } = await db.query(`SELECT public.record_application($1::jsonb) AS result`, [
    JSON.stringify({
      jobId: 'job_1',
      jobTitle: 'Medical Representative',
      applicantName: 'Ravi Kumar',
      applicantEmail: 'someone-else@example.org',
      applicantUserId: otherId,
      channel: 'email',
      to: 'manager@example.org',
      resumeDocumentId: '55555555-5555-4555-8555-555555555555',
      resumeFileName: 'My Resume.pdf',
      sentAt: 1_700_000_000_000,
    }),
  ])
  assert.equal(recorded.result.ok, true)
  assert.match(recorded.result.id, /^ap_[0-9a-f]{32}$/)

  const { rows: mine } = await db.query('SELECT public.list_my_applications() AS application')
  assert.equal(mine.length, 1)
  assert.equal(mine[0].application.applicantEmail, 'applicant@example.org', 'identity must come from the token')
  assert.equal(mine[0].application.applicantUserId, applicantId)
  assert.equal(mine[0].application.resumeFileName, 'My Resume.pdf')
  assert.equal(mine[0].application.resumeDocumentId, '55555555-5555-4555-8555-555555555555')

  await assert.rejects(
    db.query(`SELECT public.record_application($1::jsonb)`, [JSON.stringify({ jobTitle: 'MR', channel: 'email' })]),
    /job reference is required/,
    'an application must reference a job',
  )
  await assert.rejects(
    db.query(`SELECT public.record_application($1::jsonb)`, [JSON.stringify({ jobId: 'j', jobTitle: 'MR', channel: 'sms' })]),
    /Unsupported application channel/,
    'only email and WhatsApp channels are allowed',
  )

  // Another user sees none of it.
  await db.exec(`SET request.jwt.claim.sub = '${otherId}'`)
  const { rows: foreign } = await db.query('SELECT count(*)::int AS count FROM public.list_my_applications()')
  assert.equal(foreign[0].count, 0, 'another user must not read these applications')

  // An MFA-verified administrator can review every application.
  await db.exec(`SET request.jwt.claim.sub = '${adminId}'; SET test.admin = 'true'; SET test.aal = 'aal2'`)
  const { rows: [adminCount] } = await db.query('SELECT count(*)::int AS count FROM public.applications')
  assert.equal(adminCount.count, 1, 'admins keep full review access')

  // A password-only admin cannot.
  await db.exec("SET test.aal = 'aal1'")
  const { rows: [aal1Count] } = await db.query('SELECT count(*)::int AS count FROM public.applications')
  assert.equal(aal1Count.count, 0, 'password-only admins stay locked out')

  console.log('applications SQL: verified identity, owner-only history and admin review passed')
} finally {
  await db.close()
}
