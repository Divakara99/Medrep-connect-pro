-- Manual Role/Position text support. Run after vacancy_posters.sql,
-- vacancy_fill_check.sql, vacancy_extra_fields.sql, and the unlock migrations.
-- `category` remains the internal filter/HQ group. Custom Role/Position text is
-- public, persisted as data.rolePosition, and uses internal group 'Field'.

BEGIN;

ALTER TABLE public.vacancy_audit
  ADD COLUMN IF NOT EXISTS role_position text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.record_vacancy_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  actor_role_value text;
  actor_email_value text := coalesce(auth.jwt() ->> 'email', '');
  reason_value text;
BEGIN
  actor_role_value := CASE
    WHEN public.is_app_admin() THEN 'admin'
    WHEN public.is_vacancy_editor() THEN 'vacancy_editor'
    ELSE 'system'
  END;

  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.data ->> 'deleted', 'false') <> 'true' THEN
      INSERT INTO public.vacancy_audit
        (action, vacancy_id, title, company, category, role_position, location, actor_role, actor_email)
      VALUES
        ('added', NEW.id,
         coalesce(NEW.data ->> 'title', ''), coalesce(NEW.data ->> 'company', ''),
         coalesce(NEW.data ->> 'category', ''), coalesce(NEW.data ->> 'rolePosition', ''),
         coalesce(NEW.data ->> 'location', ''), actor_role_value, actor_email_value);
    END IF;
    RETURN NEW;
  END IF;

  IF coalesce(OLD.data ->> 'deleted', 'false') <> 'true'
     AND coalesce(NEW.data ->> 'deleted', 'false') = 'true' THEN
    reason_value := nullif(btrim(coalesce(NEW.data ->> 'deleteReason', '')), '');
    INSERT INTO public.vacancy_audit
      (action, vacancy_id, title, company, category, role_position, location, actor_role, actor_email, reason)
    VALUES
      ('deleted', NEW.id,
       coalesce(OLD.data ->> 'title', ''), coalesce(OLD.data ->> 'company', ''),
       coalesce(OLD.data ->> 'category', ''), coalesce(OLD.data ->> 'rolePosition', ''),
       coalesce(OLD.data ->> 'location', ''), actor_role_value, actor_email_value,
       coalesce(reason_value, 'No reason recorded'));
  END IF;
  RETURN NEW;
END;
$$;

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
      'rolePosition', nullif(v.data ->> 'rolePosition', ''),
      'extraFields', CASE
        WHEN jsonb_typeof(v.data -> 'extraFields') = 'array' THEN v.data -> 'extraFields'
        ELSE '[]'::jsonb
      END,
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
  v_role_position text := btrim(coalesce(p_fields ->> 'rolePosition', ''));
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
  IF v_role_position <> '' AND (
    length(v_role_position) < 2 OR length(v_role_position) > 80
    OR v_role_position ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}'
    OR length(regexp_replace(v_role_position, '[^0-9]', '', 'g')) >= 10
  ) THEN
    RAISE EXCEPTION 'Enter a 2 to 80 character Role/Position without contact details.' USING ERRCODE = '22023';
  END IF;
  IF v_role_position <> '' THEN v_category := 'Field'; END IF;
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
    'rolePosition', nullif(v_role_position, ''),
    'pinned', false,
    'postedAt', now_ms,
    'postedBy', caller_email
  );

  INSERT INTO public.vacancies (id, data, synced_at) VALUES (new_id, v_data, now());
  INSERT INTO public.notifications (id, data, synced_at) VALUES (
    'n_' || replace(gen_random_uuid()::text, '-', ''),
    jsonb_build_object(
      'title', 'New vacancy: ' || v_title,
      'body', v_title || ' · ' || coalesce(nullif(v_role_position, ''), v_category) || ' · ' || v_location
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
    'location', v_location, 'category', v_category,
    'rolePosition', nullif(v_role_position, ''), 'postedAt', now_ms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.employee_post_vacancy(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_post_vacancy(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.employee_list_vacancies()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_vacancy_editor() OR public.is_app_admin()) THEN
    RAISE EXCEPTION 'Only a vacancy team account can list vacancies here.' USING ERRCODE = '42501';
  END IF;

  -- Only the fields the team needs to post, answer and delete. Contact details,
  -- manager names and descriptions are not returned.
  RETURN QUERY
  SELECT jsonb_build_object(
      'id', v.id,
      'title', v.data ->> 'title',
      'company', v.data ->> 'company',
      'location', v.data ->> 'location',
      'category', v.data ->> 'category',
      'rolePosition', nullif(v.data ->> 'rolePosition', ''),
      'qualification', v.data ->> 'qualification',
      'ageLimit', v.data ->> 'ageLimit',
      'vacancyCount', v.data ->> 'vacancyCount',
      'postedAt', CASE WHEN v.data ->> 'postedAt' ~ '^[0-9]{1,13}$' THEN (v.data ->> 'postedAt')::bigint ELSE 0 END,
      'postedBy', coalesce(v.data ->> 'postedBy', ''),
      'fillCheck', v.data -> 'fillCheck'
    )
  FROM public.vacancies AS v
  WHERE coalesce(v.data ->> 'deleted', 'false') <> 'true'
  ORDER BY CASE WHEN v.data ->> 'postedAt' ~ '^[0-9]{1,13}$' THEN (v.data ->> 'postedAt')::bigint ELSE 0 END DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_list_vacancies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_list_vacancies() TO authenticated;

REVOKE ALL ON FUNCTION public.list_visible_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_visible_jobs() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
