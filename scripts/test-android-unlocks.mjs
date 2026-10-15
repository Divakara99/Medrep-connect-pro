import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const freeId = '11111111-1111-4111-8111-111111111111'
const paidId = '22222222-2222-4222-8222-222222222222'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${freeId}'), ('${paidId}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE public.user_accounts (user_id uuid PRIMARY KEY, subscribed_until timestamptz);
    CREATE TABLE public.vacancies (id text PRIMARY KEY, data jsonb NOT NULL, synced_at timestamptz DEFAULT now());
    CREATE VIEW public.vacancies_view WITH (security_invoker = true) AS SELECT id, data FROM public.vacancies;
    ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    INSERT INTO public.user_accounts VALUES ('${freeId}', NULL), ('${paidId}', now() + interval '1 day');
    INSERT INTO public.vacancies (id, data) VALUES
      ('job_1', '{"title":"Medical Representative","location":"Chennai","category":"MR","company":"Hidden Pharma","manager":"Private Manager","contact":"9999999999","managerAltPhone":"8888888888","managerEmail":"private@example.org","description":"Public points","postedAt":123,"pinned":true}');
  `)
  const secureJobs = await readFile(new URL('../supabase/secure_jobs.sql', import.meta.url), 'utf8')
  await db.exec(secureJobs)
  const unlocks = await readFile(new URL('../supabase/company_unlocks.sql', import.meta.url), 'utf8')
  await db.exec(unlocks)
  await db.exec(unlocks) // idempotent re-run

  // Free user, nothing unlocked: company field absent, flag false.
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${freeId}'`)
  let { rows } = await db.query('SELECT * FROM public.list_visible_jobs()')
  let job = rows[0].list_visible_jobs
  assert.equal(Object.hasOwn(job, 'company'), false, 'company must not be sent before unlock')
  assert.equal(job.companyUnlocked, false)

  // Users can never write their own unlock (service role only).
  await assert.rejects(
    db.query(`INSERT INTO public.company_unlocks (user_id, job_id, transaction_id) VALUES ('${freeId}', 'job_1', 'tx-forged')`),
    /permission|policy/i,
    'browser insert of an unlock must be refused',
  )

  // The Edge Function (service role) records the verified unlock.
  await db.exec(`RESET ROLE`)
  await db.exec(`INSERT INTO public.company_unlocks (user_id, job_id, transaction_id, ad_unit_id) VALUES ('${freeId}', 'job_1', 'tx-1', 'unit-1')`)
  await assert.rejects(
    db.query(`INSERT INTO public.company_unlocks (user_id, job_id, transaction_id) VALUES ('${paidId}', 'job_1', 'tx-1')`),
    /duplicate|unique/i,
    'a replayed transaction_id must be de-duplicated',
  )

  // Now the free user sees ONLY the company name back.
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${freeId}'`)
  ;({ rows } = await db.query('SELECT * FROM public.list_visible_jobs()'))
  job = rows[0].list_visible_jobs
  assert.equal(job.company, 'Hidden Pharma', 'unlocked company is returned')
  assert.equal(job.companyUnlocked, true)
  for (const field of ['manager', 'contact', 'managerEmail', 'managerAltPhone']) {
    assert.equal(Object.hasOwn(job, field), false, `${field} must stay subscriber-only after a video unlock`)
  }

  // Own-row reads only: the other user's unlock list is empty.
  const { rows: mine } = await db.query('SELECT job_id FROM public.company_unlocks')
  assert.equal(mine.length, 1)
  await db.exec(`SET request.jwt.claim.sub = '${paidId}'`)
  const { rows: theirs } = await db.query('SELECT job_id FROM public.company_unlocks')
  assert.equal(theirs.length, 0, 'users read only their own unlocks')

  // Subscriber without any unlock: all five fields, per-job flag stays false.
  ;({ rows } = await db.query('SELECT * FROM public.list_visible_jobs()'))
  job = rows[0].list_visible_jobs
  assert.equal(job.company, 'Hidden Pharma')
  assert.equal(job.manager, 'Private Manager')
  assert.equal(job.companyUnlocked, false, 'subscription must not masquerade as a per-job unlock')

  console.log('android unlocks: SSV-only writes, own-row reads, company-only projection, tx de-duplication — passed')
} finally {
  await db.close()
}
