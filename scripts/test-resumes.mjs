import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

/**
 * Private resume storage checks:
 *   - the bucket is created private and object access is owner-scoped
 *   - only the uploading user can read their resume metadata (no admin read)
 *   - retention is forced to 30 days by the server, not by the client
 *   - the retention purge removes the metadata row AND the stored object
 */
const db = new PGlite()
const ownerId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const adminId = '33333333-3333-4333-8333-333333333333'
const docId = '55555555-5555-4555-8555-555555555555'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    INSERT INTO auth.users (id, email) VALUES
      ('${ownerId}', 'owner@example.org'),
      ('${otherId}', 'other@example.org'),
      ('${adminId}', 'admin@example.org');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object(
        'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
        'app_metadata', jsonb_build_object('role', CASE WHEN current_setting('test.admin', true) = 'true' THEN 'admin' ELSE 'user' END),
        'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1')
      )
    $$;
    CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
         AND coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
    $$;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      bucket_id text NOT NULL,
      name text NOT NULL,
      owner uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (bucket_id, name)
    );
    CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE sql IMMUTABLE AS $$
      SELECT CASE
        WHEN array_length(string_to_array(name, '/'), 1) > 1
        THEN (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
        ELSE ARRAY[]::text[]
      END
    $$;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
    GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;
  `)

  const migration = await readFile(new URL('../supabase/resumes.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.exec(migration) // Repeatable migration must keep the same policies.

  const { rows: [bucket] } = await db.query("SELECT public, file_size_limit FROM storage.buckets WHERE id = 'resumes'")
  assert.equal(bucket.public, false, 'the resume bucket must stay private')
  assert.equal(Number(bucket.file_size_limit), 2_097_152)

  const { rows: [grants] } = await db.query(`SELECT
    has_function_privilege('anon', 'public.list_my_resumes()', 'EXECUTE') AS anon_list,
    has_function_privilege('anon', 'public.delete_expired_resumes()', 'EXECUTE') AS anon_purge,
    has_function_privilege('authenticated', 'public.delete_expired_resumes()', 'EXECUTE') AS user_purge`)
  assert.equal(grants.anon_list, false)
  assert.equal(grants.anon_purge, false)
  assert.equal(grants.user_purge, false, 'only the service role may purge')

  // The owner uploads a resume: metadata row + private object in their folder.
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${ownerId}'`)
  await db.query(`
    INSERT INTO public.resume_documents (id, user_id, file_name, mime_type, size_bytes, storage_path, expires_at)
    VALUES ('${docId}', '${ownerId}', 'My Resume.pdf', 'application/pdf', 204800,
            '${ownerId}/${docId}', now() + interval '10 years')`)
  await db.query(`
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('resumes', '${ownerId}/${docId}', '${ownerId}')`)

  const { rows: [own] } = await db.query(`
    SELECT file_name, extract(epoch FROM expires_at - now()) / 86400 AS days
    FROM public.resume_documents WHERE id = '${docId}'`)
  assert.equal(own.file_name, 'My Resume.pdf')
  assert.ok(Math.abs(Number(own.days) - 30) < 0.02, 'retention must be forced to 30 days, not 10 years')

  const { rows: mine } = await db.query('SELECT public.list_my_resumes() AS resume')
  assert.equal(mine.length, 1, 'the owner can list their own resume')

  // Another signed-in user cannot see, take or plant anything in that folder.
  await db.exec(`SET request.jwt.claim.sub = '${otherId}'`)
  const { rows: foreign } = await db.query('SELECT count(*)::int AS count FROM public.resume_documents')
  assert.equal(foreign[0].count, 0, 'another user must not read the resume metadata')
  // RLS hides the row, so the delete simply matches nothing.
  const foreignDelete = await db.query(`DELETE FROM public.resume_documents WHERE id = '${docId}'`)
  assert.equal(foreignDelete.affectedRows, 0, 'another user must not delete the resume record')
  await assert.rejects(
    db.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('resumes', '${ownerId}/planted', '${otherId}')`),
    /row-level security/,
    'another user must not write into the owner folder',
  )
  const { rows: foreignObjects } = await db.query(`
    SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id = 'resumes'`)
  assert.equal(foreignObjects[0].count, 0, 'the stored object must not be listable by another user')

  // Even a fully verified administrator cannot read a candidate's resume.
  await db.exec(`SET request.jwt.claim.sub = '${adminId}'; SET test.admin = 'true'; SET test.aal = 'aal2'`)
  const { rows: adminView } = await db.query('SELECT count(*)::int AS count FROM public.resume_documents')
  assert.equal(adminView[0].count, 0, 'resumes are readable only by the person who uploaded them')
  const { rows: adminObjects } = await db.query(`
    SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id = 'resumes'`)
  assert.equal(adminObjects[0].count, 0, 'the private object stays invisible to administrators')

  // Retention purge removes the row and the stored object together.
  await db.exec(`
    RESET ROLE;
    ALTER TABLE public.resume_documents DISABLE TRIGGER resume_documents_force_retention;
    UPDATE public.resume_documents SET expires_at = now() - interval '1 minute' WHERE id = '${docId}';
    ALTER TABLE public.resume_documents ENABLE TRIGGER resume_documents_force_retention;`)
  const { rows: [purged] } = await db.query('SELECT public.delete_expired_resumes() AS removed')
  assert.equal(Number(purged.removed), 1, 'the expired object must be removed from storage')
  const { rows: [leftovers] } = await db.query(`SELECT
    (SELECT count(*)::int FROM public.resume_documents) AS docs,
    (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'resumes') AS objects`)
  assert.equal(leftovers.docs, 0)
  assert.equal(leftovers.objects, 0)

  console.log('resumes SQL: private bucket, owner-only access, 30-day retention and purge passed')
} finally {
  await db.close()
}
