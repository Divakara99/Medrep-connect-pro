-- Private resume storage for job applications.
-- Run AFTER schema.sql in the SAME Supabase project as the app.
--
-- Design:
--   * The file lives in a PRIVATE Supabase Storage bucket ("resumes"). Nothing
--     is ever written to browser localStorage and there is no public URL.
--   * Objects are stored under "<user id>/<document id>". Storage policies let a
--     signed-in user touch ONLY their own folder; downloads use short-lived
--     signed URLs minted for that user.
--   * Metadata lives in public.resume_documents with owner-only RLS. Per the
--     agreed rules the ONLY reader of a resume is the user who uploaded it —
--     no administrator policy and no manager access is granted here.
--   * Retention is 30 days ("up to one month"). expires_at is forced by a
--     trigger, so a client cannot extend it, and delete_expired_resumes()
--     removes both the metadata row and the stored object.
--
-- Re-runnable: policies are dropped before being recreated.

BEGIN;

-- 1. Private bucket (2 MB, document types only). ------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  false,
  2097152,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'resumes\_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', policy_row.policyname);
  END LOOP;
END
$$;

-- Owner-scoped object access. storage.foldername(name) yields the leading path
-- segments, so "(storage.foldername(name))[1]" is the uploader's user id.
CREATE POLICY resumes_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY resumes_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY resumes_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY resumes_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2. Resume metadata (owner-only). -------------------------------------------
CREATE TABLE IF NOT EXISTS public.resume_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text NOT NULL CHECK (length(btrim(file_name)) > 0),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  storage_path text NOT NULL UNIQUE,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

CREATE INDEX IF NOT EXISTS resume_documents_user_uploaded_idx
  ON public.resume_documents (user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS resume_documents_expires_idx
  ON public.resume_documents (expires_at);

-- Retention is server-owned: every write recomputes the 30-day window.
CREATE OR REPLACE FUNCTION public.resume_documents_force_retention()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.uploaded_at := now();
  NEW.expires_at := now() + interval '30 days';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS resume_documents_force_retention ON public.resume_documents;
CREATE TRIGGER resume_documents_force_retention
  BEFORE INSERT OR UPDATE OF uploaded_at, expires_at ON public.resume_documents
  FOR EACH ROW EXECUTE FUNCTION public.resume_documents_force_retention();

ALTER TABLE public.resume_documents ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'resume_documents'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.resume_documents', policy_row.policyname);
  END LOOP;
END
$$;
-- Owner only. There is deliberately NO administrator policy: an uploaded resume
-- is readable only by the person who uploaded it.
CREATE POLICY resume_documents_owner_all ON public.resume_documents
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.resume_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resume_documents TO authenticated;
GRANT ALL ON public.resume_documents TO service_role;

-- 3. Retention cleanup. -------------------------------------------------------
-- Deletes the stored object and the metadata row for every expired resume.
-- Schedule it with pg_cron (see DEPLOY.md):
--   select cron.schedule('purge-expired-resumes', '17 19 * * *',
--     $$select public.delete_expired_resumes()$$);
CREATE OR REPLACE FUNCTION public.delete_expired_resumes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, storage
AS $$
DECLARE
  removed integer;
BEGIN
  WITH expired AS (
    DELETE FROM public.resume_documents
    WHERE expires_at <= now()
    RETURNING storage_path
  )
  DELETE FROM storage.objects
  WHERE bucket_id = 'resumes'
    AND name IN (SELECT storage_path FROM expired);

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_expired_resumes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expired_resumes() TO service_role;

-- Convenience read for the app: the uploader's own resumes, newest first.
CREATE OR REPLACE FUNCTION public.list_my_resumes()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'id', id,
    'fileName', file_name,
    'mimeType', mime_type,
    'size', size_bytes,
    'storagePath', storage_path,
    'uploadedAt', uploaded_at,
    'expiresAt', expires_at
  )
  FROM public.resume_documents
  WHERE user_id = auth.uid()
  ORDER BY uploaded_at DESC
$$;
REVOKE ALL ON FUNCTION public.list_my_resumes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_resumes() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
