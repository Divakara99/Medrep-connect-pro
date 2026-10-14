-- Vacancy extraction fields and server-side duplicate review.
-- Run AFTER vacancy_team.sql and secure_jobs.sql in the SAME Supabase project.
-- Admins must have the existing AAL2/MFA session; vacancy_editor accounts may
-- check/post through the role-scoped functions. No user-facing RPC can inspect
-- this duplicate data.

BEGIN;

-- Normalize spacing/case for exact comparison without changing the stored data.
CREATE OR REPLACE FUNCTION public.vacancy_match_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(value, '')), '[[:space:]]+', ' ', 'g'))
$$;
REVOKE ALL ON FUNCTION public.vacancy_match_text(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_vacancy_duplicates(
  p_fields jsonb,
  p_exclude_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  result jsonb;
  v_title text;
  v_company text;
  v_location text;
  v_category text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to check vacancy duplicates.' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.is_app_admin() OR public.is_vacancy_editor()) THEN
    RAISE EXCEPTION 'Only an administrator or vacancy employee can check duplicates.' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'Vacancy details are required for the duplicate check.' USING ERRCODE = '22023';
  END IF;

  v_title := public.vacancy_match_text(p_fields ->> 'title');
  v_company := public.vacancy_match_text(p_fields ->> 'company');
  v_location := public.vacancy_match_text(p_fields ->> 'location');
  v_category := public.vacancy_match_text(p_fields ->> 'category');

  IF v_title = '' OR v_company = '' OR v_location = '' OR v_category = '' THEN
    RETURN jsonb_build_object('status', 'incomplete', 'matches', '[]'::jsonb);
  END IF;

  WITH candidates AS (
    SELECT
      v.id,
      v.data,
      CASE WHEN v.data ->> 'postedAt' ~ '^[0-9]{1,13}$'
        THEN (v.data ->> 'postedAt')::bigint ELSE 0 END AS posted_ms,
      public.vacancy_match_text(v.data ->> 'division') AS division_norm,
      public.vacancy_match_text(v.data ->> 'hq') AS hq_norm,
      public.vacancy_match_text(v.data ->> 'salary') AS salary_norm,
      public.vacancy_match_text(v.data ->> 'experience') AS experience_norm,
      public.vacancy_match_text(v.data ->> 'qualification') AS qualification_norm,
      public.vacancy_match_text(v.data ->> 'ageLimit') AS age_limit_norm,
      public.vacancy_match_text(v.data ->> 'vacancyCount') AS vacancy_count_norm,
      public.vacancy_match_text(v.data ->> 'description') AS description_norm
    FROM public.vacancies AS v
    WHERE coalesce(v.data ->> 'deleted', 'false') <> 'true'
      AND (p_exclude_id IS NULL OR v.id <> p_exclude_id)
      AND public.vacancy_match_text(v.data ->> 'title') = v_title
      AND public.vacancy_match_text(v.data ->> 'company') = v_company
      AND public.vacancy_match_text(v.data ->> 'location') = v_location
      AND public.vacancy_match_text(v.data ->> 'category') = v_category
    ORDER BY CASE WHEN v.data ->> 'postedAt' ~ '^[0-9]{1,13}$'
      THEN (v.data ->> 'postedAt')::bigint ELSE 0 END DESC
    LIMIT 250
  ), classified AS (
    SELECT
      id,
      data,
      posted_ms,
      (
        division_norm = public.vacancy_match_text(p_fields ->> 'division')
        AND hq_norm = public.vacancy_match_text(p_fields ->> 'hq')
        AND salary_norm = public.vacancy_match_text(p_fields ->> 'salary')
        AND experience_norm = public.vacancy_match_text(p_fields ->> 'experience')
        AND qualification_norm = public.vacancy_match_text(p_fields ->> 'qualification')
        AND age_limit_norm = public.vacancy_match_text(p_fields ->> 'ageLimit')
        AND vacancy_count_norm = public.vacancy_match_text(p_fields ->> 'vacancyCount')
        AND description_norm = public.vacancy_match_text(p_fields ->> 'description')
      ) AS exact_match,
      (
        (public.vacancy_match_text(p_fields ->> 'division') = '' OR division_norm = '' OR division_norm = public.vacancy_match_text(p_fields ->> 'division'))
        AND (public.vacancy_match_text(p_fields ->> 'hq') = '' OR hq_norm = '' OR hq_norm = public.vacancy_match_text(p_fields ->> 'hq'))
        AND (public.vacancy_match_text(p_fields ->> 'salary') = '' OR salary_norm = '' OR salary_norm = public.vacancy_match_text(p_fields ->> 'salary'))
        AND (public.vacancy_match_text(p_fields ->> 'experience') = '' OR experience_norm = '' OR experience_norm = public.vacancy_match_text(p_fields ->> 'experience'))
        AND (public.vacancy_match_text(p_fields ->> 'qualification') = '' OR qualification_norm = '' OR qualification_norm = public.vacancy_match_text(p_fields ->> 'qualification'))
        AND (public.vacancy_match_text(p_fields ->> 'ageLimit') = '' OR age_limit_norm = '' OR age_limit_norm = public.vacancy_match_text(p_fields ->> 'ageLimit'))
        AND (public.vacancy_match_text(p_fields ->> 'vacancyCount') = '' OR vacancy_count_norm = '' OR vacancy_count_norm = public.vacancy_match_text(p_fields ->> 'vacancyCount'))
        AND (public.vacancy_match_text(p_fields ->> 'description') = '' OR description_norm = '' OR description_norm = public.vacancy_match_text(p_fields ->> 'description'))
      ) AS compatible_match
    FROM candidates
  )
  SELECT jsonb_build_object(
    'status', CASE
      WHEN coalesce(bool_or(exact_match), false) THEN 'exact'
      WHEN coalesce(bool_or(compatible_match), false) THEN 'possible'
      ELSE 'none'
    END,
    'matches', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'title', coalesce(data ->> 'title', ''),
          'company', coalesce(data ->> 'company', ''),
          'location', coalesce(data ->> 'location', ''),
          'category', coalesce(data ->> 'category', ''),
          'division', data ->> 'division',
          'hq', data ->> 'hq',
          'salary', data ->> 'salary',
          'experience', data ->> 'experience',
          'qualification', data ->> 'qualification',
          'ageLimit', data ->> 'ageLimit',
          'vacancyCount', data ->> 'vacancyCount',
          'postedAt', posted_ms,
          'matchType', CASE WHEN exact_match THEN 'exact' ELSE 'possible' END
        ) ORDER BY exact_match DESC, posted_ms DESC
      ) FILTER (WHERE exact_match OR compatible_match),
      '[]'::jsonb
    )
  )
  INTO result
  FROM classified;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.check_vacancy_duplicates(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_vacancy_duplicates(jsonb, text) TO authenticated;

-- Keep employee-created vacancies' new public fields in the trusted insert.
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

-- The employee vacancy list may show the new non-confidential fields, but
-- continues to withhold manager/contact data and the description.
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

  RETURN QUERY
  SELECT jsonb_build_object(
      'id', v.id,
      'title', v.data ->> 'title',
      'company', v.data ->> 'company',
      'location', v.data ->> 'location',
      'category', v.data ->> 'category',
      'qualification', v.data ->> 'qualification',
      'ageLimit', v.data ->> 'ageLimit',
      'vacancyCount', v.data ->> 'vacancyCount',
      'postedAt', CASE WHEN v.data ->> 'postedAt' ~ '^[0-9]{1,13}$' THEN (v.data ->> 'postedAt')::bigint ELSE 0 END,
      'postedBy', coalesce(v.data ->> 'postedBy', '')
    )
  FROM public.vacancies AS v
  WHERE coalesce(v.data ->> 'deleted', 'false') <> 'true'
  ORDER BY CASE WHEN v.data ->> 'postedAt' ~ '^[0-9]{1,13}$' THEN (v.data ->> 'postedAt')::bigint ELSE 0 END DESC
  LIMIT 500;
END;
$$;

-- Public job details remain safe: these new eligibility fields are public,
-- while the five existing manager/company contact fields stay subscriber-only.
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
  SELECT
    jsonb_build_object(
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
      'postedAt', coalesce((v.data ->> 'postedAt')::bigint, 0)
    ) || CASE WHEN can_view_private THEN
      jsonb_build_object(
        'company', v.data ->> 'company',
        'manager', v.data ->> 'manager',
        'contact', v.data ->> 'contact',
        'managerAltPhone', v.data ->> 'managerAltPhone',
        'managerEmail', v.data ->> 'managerEmail'
      ) ELSE '{}'::jsonb END
  FROM public.vacancies AS v
  WHERE coalesce(v.data ->> 'deleted', 'false') <> 'true'
  ORDER BY coalesce((v.data ->> 'pinned')::boolean, false) DESC,
           coalesce((v.data ->> 'postedAt')::bigint, 0) DESC
  LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.list_visible_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_visible_jobs() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
