import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'

/**
 * The job description is public, so the form and the database both refuse
 * contact details in it. They are two implementations of one rule, so this test
 * runs the SAME inputs through both and requires them to agree.
 *
 * The client side is the real shipping source (src/data/jobDescription.ts),
 * transpiled here rather than re-implemented. The database side is the real
 * vacancy_public_description_guard trigger from supabase/secure_jobs.sql.
 */

const CASES = [
  { description: 'Field sales\nDoctor and chemist calls', expectSafe: true },
  { description: 'Graduate with 0-3 years of pharma experience', expectSafe: true },
  { description: 'Salary 25000 per month plus incentives', expectSafe: true },
  { description: 'Territory: Chennai 600001', expectSafe: true },
  { description: '12 doctor calls per day', expectSafe: true },
  { description: '', expectSafe: true },
  { description: 'Contact hr@hiddenpharma.example for details', expectSafe: false },
  { description: 'Send your CV to jobs.company@corp.co.in', expectSafe: false },
  { description: 'Call +91 98765 43210', expectSafe: false },
  { description: 'Reach the manager on 9876543210', expectSafe: false },
  { description: 'WhatsApp: 044-2876 5432', expectSafe: false },
  { description: 'Order ref 1234567890123 for onboarding', expectSafe: false },
]

async function loadClientGuard() {
  const source = await readFile(new URL('../src/data/jobDescription.ts', import.meta.url), 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: 'jobDescription.ts',
  }).outputText
  const directory = await mkdtemp(join(tmpdir(), 'mrc-guard-'))
  const file = join(directory, 'jobDescription.mjs')
  await writeFile(file, javascript)
  const module = await import(pathToFileURL(file).href)
  assert.equal(typeof module.findConfidentialContact, 'function', 'the shipping guard must be importable')
  return module.findConfidentialContact
}

const db = new PGlite()
try {
  const findConfidentialContact = await loadClientGuard()

  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object(
        'app_metadata', jsonb_build_object('role', CASE WHEN current_setting('test.admin', true) = 'true' THEN 'admin' ELSE 'user' END),
        'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1')
      )
    $$;
    CREATE TABLE public.user_accounts (user_id uuid PRIMARY KEY, subscribed_until timestamptz);
    CREATE TABLE public.vacancies (id text PRIMARY KEY, data jsonb NOT NULL, synced_at timestamptz DEFAULT now());
    CREATE VIEW public.vacancies_view WITH (security_invoker = true) AS SELECT id, data FROM public.vacancies;
    ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE POLICY test_access ON public.vacancies FOR ALL TO authenticated
      USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.vacancies TO authenticated;
  `)
  await db.exec(await readFile(new URL('../supabase/secure_jobs.sql', import.meta.url), 'utf8'))
  await db.exec("SET ROLE authenticated; SET test.admin = 'true'; SET test.aal = 'aal2'")

  let index = 0
  for (const testCase of CASES) {
    index += 1
    const id = `case_${index}`

    const clientMessage = findConfidentialContact(testCase.description)
    const clientAllows = clientMessage === null

    let databaseAllows = true
    try {
      await db.query('INSERT INTO public.vacancies (id, data) VALUES ($1, $2::jsonb)', [
        id,
        JSON.stringify({ title: 'MR', location: 'Chennai', category: 'MR', description: testCase.description }),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      assert.match(message, /description is public/, `unexpected database failure for case ${index}`)
      databaseAllows = false
    }

    assert.equal(
      clientAllows,
      databaseAllows,
      `client and database disagree for: ${JSON.stringify(testCase.description)}`,
    )
    assert.equal(
      clientAllows,
      testCase.expectSafe,
      `wrong verdict for: ${JSON.stringify(testCase.description)}`,
    )
  }

  // A rejected write must leave nothing behind.
  const { rows: [stored] } = await db.query('SELECT count(*)::int AS count FROM public.vacancies')
  assert.equal(
    stored.count,
    CASES.filter((testCase) => testCase.expectSafe).length,
    'only the safe descriptions may be stored',
  )

  console.log(`description guard: client and database agree on all ${CASES.length} cases`)
} finally {
  await db.close()
}
