-- Private vacancy poster images. Run AFTER every migration that defines
-- list_visible_jobs() (including vacancy_duplicate_check.sql and the unlock
-- migrations), and AFTER vacancy_team.sql if that file is used.
-- Uploads are allowed to administrators and vacancy editors. Downloads are
-- allowed only when the job's full contact details are visible (active
-- subscription or paid per-job unlock).

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vacancy-posters', 'vacancy-posters', false, 8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS vacancy_posters_admin_insert ON storage.objects;
CREATE POLICY vacancy_posters_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vacancy-posters'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (
      coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
      OR coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false)
      OR public.is_vacancy_editor()
    )
  );

DROP POLICY IF EXISTS vacancy_posters_entitled_read ON storage.objects;
CREATE POLICY vacancy_posters_entitled_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'vacancy-posters'
    AND EXISTS (
      SELECT 1
      FROM public.vacancies AS v
      LEFT JOIN public.user_accounts AS ua ON ua.user_id = auth.uid()
      WHERE v.data ->> 'posterPath' = name
        AND coalesce(v.data ->> 'deleted', 'false') <> 'true'
        AND (
          coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
          OR coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false)
          OR coalesce(ua.subscribed_until > now(), false)
          OR EXISTS (
            SELECT 1 FROM public.job_unlocks AS ju
            WHERE ju.user_id = auth.uid() AND ju.job_id = v.id
              AND ju.payment_status = 'paid'
              AND (ju.expires_at IS NULL OR ju.expires_at > now())
          )
        )
    )
  );

DROP POLICY IF EXISTS vacancy_posters_admin_delete ON storage.objects;
CREATE POLICY vacancy_posters_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'vacancy-posters'
    AND (
      coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
      OR coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false)
    )
  );
DROP POLICY IF EXISTS vacancy_posters_editor_delete_own ON storage.objects;

-- Editors may clean up their failed upload only while it is still unattached.
-- Once a vacancy references an image, its owner cannot remove it behind users.
CREATE OR REPLACE FUNCTION public.delete_unattached_vacancy_poster(p_path text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, storage
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_vacancy_editor()
    OR split_part(coalesce(p_path, ''), '/', 1) <> auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot remove this vacancy poster.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vacancies WHERE data ->> 'posterPath' = p_path) THEN
    RAISE EXCEPTION 'An attached vacancy poster cannot be removed.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM storage.objects
  WHERE bucket_id = 'vacancy-posters' AND name = p_path;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_unattached_vacancy_poster(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_unattached_vacancy_poster(text) TO authenticated;

-- list_visible_jobs() is replaced here once, to add posterPath without changing
-- any existing entitlement fields. Apply this after the latest unlock SQL.
CREATE OR REPLACE FUNCTION public.list_visible_jobs()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  can_view_private boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to see jobs.' USING ERRCODE = '28000';
  END IF;

  SELECT coalesce(subscribed_until > now(), false)
  INTO can_view_private
  FROM public.user_accounts
  WHERE user_id = auth.uid();

  RETURN QUERY
  SELECT jsonb_build_object(
      'id', v.id,
      'title', v.data ->> 'title',
      'location', v.data ->> 'location',
      'category', v.data ->> 'category',
      'salary', v.data ->> 'salary',
      'experience', v.data ->> 'experience',
      'qualification', v.data ->> 'qualification',
      'ageLimit', v.data ->> 'ageLimit',
      'vacancyCount', v.data ->> 'vacancyCount',
      'description', v.data ->> 'description',
      'hq', v.data ->> 'hq',
      'division', v.data ->> 'division',
      'pinned', coalesce((v.data ->> 'pinned')::boolean, false),
      'postedAt', coalesce((v.data ->> 'postedAt')::bigint, 0),
      'companyUnlocked', EXISTS (
        SELECT 1 FROM public.company_unlocks AS cu
        WHERE cu.user_id = auth.uid() AND cu.job_id = v.id AND cu.expires_at > now()
      ),
      'unlockExpiresAt', (
        SELECT max(cu.expires_at)::text FROM public.company_unlocks AS cu
        WHERE cu.user_id = auth.uid() AND cu.job_id = v.id AND cu.expires_at > now()
      ),
      'jobUnlocked', EXISTS (
        SELECT 1 FROM public.job_unlocks AS ju
        WHERE ju.user_id = auth.uid() AND ju.job_id = v.id
          AND ju.payment_status = 'paid'
          AND (ju.expires_at IS NULL OR ju.expires_at > now())
      ),
      'jobUnlockExpiresAt', (
        SELECT max(ju.expires_at)::text FROM public.job_unlocks AS ju
        WHERE ju.user_id = auth.uid() AND ju.job_id = v.id
          AND ju.payment_status = 'paid'
          AND (ju.expires_at IS NULL OR ju.expires_at > now())
          AND (ju.expires_at IS NULL OR ju.expires_at < 'infinity'::timestamptz)
      )
    ) || CASE
      WHEN can_view_private OR EXISTS (
        SELECT 1 FROM public.job_unlocks AS ju
        WHERE ju.user_id = auth.uid() AND ju.job_id = v.id
          AND ju.payment_status = 'paid'
          AND (ju.expires_at IS NULL OR ju.expires_at > now())
      ) THEN jsonb_build_object(
        'company', v.data ->> 'company',
        'manager', v.data ->> 'manager',
        'contact', v.data ->> 'contact',
        'managerAltPhone', v.data ->> 'managerAltPhone',
        'managerEmail', v.data ->> 'managerEmail',
        'posterPath', v.data ->> 'posterPath'
      )
      WHEN EXISTS (
        SELECT 1 FROM public.company_unlocks AS cu
        WHERE cu.user_id = auth.uid() AND cu.job_id = v.id AND cu.expires_at > now()
      ) THEN jsonb_build_object('company', v.data ->> 'company')
      ELSE '{}'::jsonb
    END
  FROM public.vacancies AS v
  WHERE coalesce(v.data ->> 'deleted', 'false') <> 'true'
  ORDER BY coalesce((v.data ->> 'pinned')::boolean, false) DESC,
           coalesce((v.data ->> 'postedAt')::bigint, 0) DESC
  LIMIT 500;
END;
$$;

-- Keep the vacancy-team posting RPC in sync so employee-created vacancies can
-- also attach the private poster. A caller may reference only an object they
-- uploaded under their own Auth user folder.
CREATE OR REPLACE FUNCTION public.employee_post_vacancy(p_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  caller_email text := coalesce(auth.jwt() ->> 'email', '');
  new_id text := gen_random_uuid()::text;
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_title text;
  v_company text;
  v_location text;
  v_category text;
  v_poster_path text := btrim(coalesce(p_fields ->> 'posterPath', ''));
  v_data jsonb;
  allowed_categories text[] := ARRAY[
    'MR', 'ABM', 'Part-time', 'E-commerce', 'Finance', 'Banking',
    'IT', 'Healthcare', 'Insurance', 'FMCG', 'Field'
  ];
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_vacancy_editor() OR public.is_app_admin()) THEN
    RAISE EXCEPTION 'Only a vacancy team account can post vacancies.' USING ERRCODE = '42501';
  END IF;

  v_title := btrim(coalesce(p_fields ->> 'title', ''));
  v_company := btrim(coalesce(p_fields ->> 'company', ''));
  v_location := btrim(coalesce(p_fields ->> 'location', ''));
  v_category := coalesce(p_fields ->> 'category', '');

  IF length(v_title) < 2 OR length(v_title) > 120 THEN
    RAISE EXCEPTION 'Enter a job title of 2 to 120 characters.' USING ERRCODE = '22023';
  END IF;
  IF length(v_company) < 2 OR length(v_company) > 120 THEN
    RAISE EXCEPTION 'Enter the company name of 2 to 120 characters.' USING ERRCODE = '22023';
  END IF;
  IF length(v_location) < 2 OR length(v_location) > 120 THEN
    RAISE EXCEPTION 'Enter the city of 2 to 120 characters.' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_category = ANY (allowed_categories)) THEN
    RAISE EXCEPTION 'Choose a valid category.' USING ERRCODE = '22023';
  END IF;
  IF v_poster_path <> '' AND (
    length(v_poster_path) > 200
    OR split_part(v_poster_path, '/', 1) <> auth.uid()::text
    OR NOT EXISTS (
      SELECT 1 FROM storage.objects AS so
      WHERE so.bucket_id = 'vacancy-posters' AND so.name = v_poster_path
    )
  ) THEN
    RAISE EXCEPTION 'Choose a poster uploaded from this account.' USING ERRCODE = '22023';
  END IF;

  v_data := jsonb_build_object(
    'title', v_title,
    'company', v_company,
    'location', v_location,
    'category', v_category,
    'manager', left(btrim(coalesce(p_fields ->> 'manager', '')), 120),
    'contact', left(btrim(coalesce(p_fields ->> 'contact', '')), 120),
    'managerAltPhone', left(btrim(coalesce(p_fields ->> 'managerAltPhone', '')), 120),
    'managerEmail', left(btrim(coalesce(p_fields ->> 'managerEmail', '')), 200),
    'hq', left(btrim(coalesce(p_fields ->> 'hq', '')), 120),
    'division', left(btrim(coalesce(p_fields ->> 'division', '')), 120),
    'salary', left(btrim(coalesce(p_fields ->> 'salary', '')), 120),
    'experience', left(btrim(coalesce(p_fields ->> 'experience', '')), 120),
    'qualification', left(btrim(coalesce(p_fields ->> 'qualification', '')), 200),
    'ageLimit', left(btrim(coalesce(p_fields ->> 'ageLimit', '')), 120),
    'vacancyCount', left(btrim(coalesce(p_fields ->> 'vacancyCount', '')), 80),
    'description', left(coalesce(p_fields ->> 'description', ''), 4000),
    'posterPath', nullif(v_poster_path, ''),
    'pinned', false,
    'postedAt', now_ms,
    'postedBy', caller_email
  );

  INSERT INTO public.vacancies (id, data, synced_at) VALUES (new_id, v_data, now());
  INSERT INTO public.notifications (id, data, synced_at) VALUES (
    'n_' || replace(gen_random_uuid()::text, '-', ''),
    jsonb_build_object(
      'title', 'New vacancy: ' || v_title,
      'body', v_title || ' · ' || v_category || ' · ' || v_location
        || E'\n\nOpen Priority Jobs to view the vacancy. Company details are available with an active subscription.',
      'type', 'job',
      'createdAt', now_ms,
      'from', 'MedRep Connect Pro',
      'target', 'all',
      'meta', jsonb_build_object('jobId', new_id)
    ),
    now()
  );
  RETURN jsonb_build_object(
    'id', new_id, 'title', v_title, 'company', v_company,
    'location', v_location, 'category', v_category, 'postedAt', now_ms
  );
END;
$$;
REVOKE ALL ON FUNCTION public.employee_post_vacancy(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_post_vacancy(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.list_visible_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_visible_jobs() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
