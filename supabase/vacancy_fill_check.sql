-- "Is this vacancy still open?" — the ask and the answer.
--
-- The administrator decides whether to delete or keep a vacancy by asking, not
-- by guessing. The ask is stored on the vacancy itself (`data.fillCheck`), so it
-- needs no new table and no notification plumbing: the team's portal lists it,
-- and the administrator's list reads the answer from the same row.
--
--   data.fillCheck = {
--     askedAt, askedBy,           -- written by the administrator's app
--     answer: 'open' | 'filled',  -- written here, never by the browser
--     answeredAt, answeredBy
--   }
--
-- Run after supabase/vacancy_team.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The team's list now carries the question.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. The team answers. The identity and the time come from the token, not the
--    browser, and only a vacancy that was actually asked about can be answered.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_answer_fill_check(p_id text, p_answer text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  caller_email text := coalesce(auth.jwt() ->> 'email', '');
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  answer_text text := btrim(coalesce(p_answer, ''));
  current_row public.vacancies%ROWTYPE;
  asked jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_vacancy_editor() OR public.is_app_admin()) THEN
    RAISE EXCEPTION 'Only a vacancy team account can answer this.' USING ERRCODE = '42501';
  END IF;
  IF answer_text NOT IN ('open', 'filled') THEN
    RAISE EXCEPTION 'Answer must be open or filled.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_row FROM public.vacancies WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR coalesce(current_row.data ->> 'deleted', 'false') = 'true' THEN
    RAISE EXCEPTION 'This vacancy no longer exists.' USING ERRCODE = 'P0002';
  END IF;

  asked := current_row.data -> 'fillCheck';
  IF asked IS NULL OR coalesce(asked ->> 'askedAt', '') = '' THEN
    RAISE EXCEPTION 'The administrator has not asked about this vacancy.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.vacancies
  SET data = current_row.data || jsonb_build_object(
        'fillCheck', asked || jsonb_build_object(
          'answer', answer_text,
          'answeredAt', now_ms,
          'answeredBy', caller_email
        )
      ),
      synced_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'answer', answer_text);
END;
$$;

REVOKE ALL ON FUNCTION public.employee_list_vacancies() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.employee_answer_fill_check(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_list_vacancies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_answer_fill_check(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
