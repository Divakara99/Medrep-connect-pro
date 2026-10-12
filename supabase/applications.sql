-- Server-side application records for job seekers.
-- Run AFTER schema.sql in the SAME Supabase project as the app.
--
-- The raw public.applications table stays admin-only (schema.sql). These two
-- RPCs are the only way an ordinary signed-in user can write and read their own
-- application history:
--   * record_application() stamps the caller's verified identity on the row, so
--     a user cannot file (or hide) an application for somebody else.
--   * list_my_applications() returns only the caller's rows.
--
-- A resume is never copied into this table. It stores only the resume's file
-- name and the id of the private resume_documents row, which stays readable by
-- its owner alone (see resumes.sql).

BEGIN;

CREATE OR REPLACE FUNCTION public.record_application(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  caller_email text;
  channel text;
  record_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before sending an application.' USING ERRCODE = '28000';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'An application payload is required.' USING ERRCODE = '22023';
  END IF;

  IF coalesce(btrim(p_payload ->> 'jobId'), '') = ''
     OR coalesce(btrim(p_payload ->> 'jobTitle'), '') = '' THEN
    RAISE EXCEPTION 'A job reference is required.' USING ERRCODE = '22023';
  END IF;

  channel := lower(coalesce(p_payload ->> 'channel', 'email'));
  IF channel NOT IN ('email', 'whatsapp') THEN
    RAISE EXCEPTION 'Unsupported application channel.' USING ERRCODE = '22023';
  END IF;

  -- The verified token wins over anything the browser sent.
  caller_email := coalesce(nullif(btrim(auth.jwt() ->> 'email'), ''), '');
  record_id := 'ap_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.applications (id, data, synced_at)
  VALUES (
    record_id,
    jsonb_strip_nulls(p_payload
      || jsonb_build_object(
        'id', record_id,
        'applicantUserId', auth.uid(),
        'applicantEmail', caller_email,
        'applicantName', left(coalesce(btrim(p_payload ->> 'applicantName'), 'Job Seeker'), 120),
        'channel', channel,
        'sentAt', coalesce((p_payload ->> 'sentAt')::bigint, floor(extract(epoch FROM now()) * 1000)::bigint)
      )
    ),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'id', record_id);
END;
$$;
REVOKE ALL ON FUNCTION public.record_application(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_application(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_applications()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  caller_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to see your applications.' USING ERRCODE = '28000';
  END IF;

  caller_email := coalesce(nullif(btrim(auth.jwt() ->> 'email'), ''), '');

  RETURN QUERY
  SELECT a.data
  FROM public.applications AS a
  WHERE (a.data ->> 'applicantUserId') = auth.uid()::text
     OR lower(coalesce(a.data ->> 'applicantEmail', '')) = lower(caller_email)
  ORDER BY coalesce((a.data ->> 'sentAt')::bigint, 0) DESC
  LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.list_my_applications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_applications() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
