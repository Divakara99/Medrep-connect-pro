-- Vacancy team: login accounts that can only post and delete vacancies, plus an
-- audit log of every vacancy added or deleted (by admin or by the team).
-- Run AFTER schema.sql, secure_jobs.sql and admin_mfa.sql in the SAME project.
-- Repeatable: safe to run more than once.
--
-- Who can do what:
--   * Admin (role admin + aal2): everything, including reading the audit log
--     and managing team logins through the admin-manage-employees function.
--   * Vacancy team (role vacancy_editor): post a vacancy, list active
--     vacancies and delete one with a reason. No direct table access, no
--     audit access, no user or payment data.
--   * Audit rows are written only by a trigger on public.vacancies. Nobody can
--     insert, update or delete them through the API.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Role helper. The role comes from app_metadata, which only the service role
--    (the admin-manage-employees function) can set. Users cannot change it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_vacancy_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, auth
AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'vacancy_editor', false)
$$;
REVOKE ALL ON FUNCTION public.is_vacancy_editor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_vacancy_editor() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Team logins (one row per vacancy_editor account). Written only by the
--    admin-manage-employees function with the service role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vacancy_employees (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only one employee login at a time. A unique index on a constant allows one
-- row; a second insert fails in the database, even if two requests race.
CREATE UNIQUE INDEX IF NOT EXISTS vacancy_employees_single_login
  ON public.vacancy_employees ((true));

ALTER TABLE public.vacancy_employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_read_vacancy_employees ON public.vacancy_employees;
CREATE POLICY admin_read_vacancy_employees ON public.vacancy_employees
  FOR SELECT TO authenticated
  USING (public.is_app_admin());
REVOKE ALL ON public.vacancy_employees FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vacancy_employees TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Audit log: one row per vacancy added and per vacancy deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vacancy_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('added', 'deleted')),
  vacancy_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  actor_role text NOT NULL CHECK (actor_role IN ('admin', 'vacancy_editor', 'system', 'earlier')),
  actor_email text NOT NULL DEFAULT '',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vacancy_audit_delete_reason CHECK (
    action = 'added' OR (reason IS NOT NULL AND btrim(reason) <> '')
  )
);

CREATE INDEX IF NOT EXISTS vacancy_audit_created_idx ON public.vacancy_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS vacancy_audit_vacancy_idx ON public.vacancy_audit (vacancy_id, action);

ALTER TABLE public.vacancy_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_read_vacancy_audit ON public.vacancy_audit;
CREATE POLICY admin_read_vacancy_audit ON public.vacancy_audit
  FOR SELECT TO authenticated
  USING (public.is_app_admin());
REVOKE ALL ON public.vacancy_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vacancy_audit TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Trigger: records every add and every delete, whoever makes it.
--    Deletes are detected from the tombstone (data.deleted = true), so admin
--    deletes and team deletes are both captured. Title and company come from
--    the row BEFORE the change, because a tombstone may not carry them.
-- ---------------------------------------------------------------------------
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
        (action, vacancy_id, title, company, category, location, actor_role, actor_email)
      VALUES
        ('added', NEW.id,
         coalesce(NEW.data ->> 'title', ''), coalesce(NEW.data ->> 'company', ''),
         coalesce(NEW.data ->> 'category', ''), coalesce(NEW.data ->> 'location', ''),
         actor_role_value, actor_email_value);
    END IF;
    RETURN NEW;
  END IF;

  IF coalesce(OLD.data ->> 'deleted', 'false') <> 'true'
     AND coalesce(NEW.data ->> 'deleted', 'false') = 'true' THEN
    reason_value := nullif(btrim(coalesce(NEW.data ->> 'deleteReason', '')), '');
    INSERT INTO public.vacancy_audit
      (action, vacancy_id, title, company, category, location, actor_role, actor_email, reason)
    VALUES
      ('deleted', NEW.id,
       coalesce(OLD.data ->> 'title', ''), coalesce(OLD.data ->> 'company', ''),
       coalesce(OLD.data ->> 'category', ''), coalesce(OLD.data ->> 'location', ''),
       actor_role_value, actor_email_value,
       coalesce(reason_value, 'No reason recorded'));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_vacancy_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS record_vacancy_audit ON public.vacancies;
CREATE TRIGGER record_vacancy_audit
  AFTER INSERT OR UPDATE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION public.record_vacancy_audit();

-- ---------------------------------------------------------------------------
-- 5. Backfill vacancies that existed before tracking began, so the totals are
--    complete. Labelled 'earlier' so the admin can tell them apart. Idempotent.
-- ---------------------------------------------------------------------------
INSERT INTO public.vacancy_audit
  (action, vacancy_id, title, company, category, location, actor_role, actor_email, reason, created_at)
SELECT 'added', v.id,
       coalesce(v.data ->> 'title', ''), coalesce(v.data ->> 'company', ''),
       coalesce(v.data ->> 'category', ''), coalesce(v.data ->> 'location', ''),
       'earlier', '', NULL,
       CASE WHEN v.data ->> 'postedAt' ~ '^[0-9]{1,13}$'
            THEN to_timestamp((v.data ->> 'postedAt')::bigint / 1000.0)
            ELSE now() END
FROM public.vacancies AS v
WHERE NOT EXISTS (
  SELECT 1 FROM public.vacancy_audit AS a WHERE a.vacancy_id = v.id AND a.action = 'added'
);

INSERT INTO public.vacancy_audit
  (action, vacancy_id, title, company, category, location, actor_role, actor_email, reason, created_at)
SELECT 'deleted', v.id,
       coalesce(v.data ->> 'title', ''), coalesce(v.data ->> 'company', ''),
       coalesce(v.data ->> 'category', ''), coalesce(v.data ->> 'location', ''),
       'earlier', '', 'Deleted before activity tracking began',
       CASE WHEN v.data ->> 'deletedAt' ~ '^[0-9]{1,13}$'
            THEN to_timestamp((v.data ->> 'deletedAt')::bigint / 1000.0)
            ELSE now() END
FROM public.vacancies AS v
WHERE coalesce(v.data ->> 'deleted', 'false') = 'true'
  AND NOT EXISTS (
    SELECT 1 FROM public.vacancy_audit AS a WHERE a.vacancy_id = v.id AND a.action = 'deleted'
  );

-- ---------------------------------------------------------------------------
-- 6. Team functions. Each one checks the caller's role itself, so it is safe
--    to call from the browser with the publishable key and a user session.
-- ---------------------------------------------------------------------------
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
    'description', left(coalesce(p_fields ->> 'description', ''), 4000),
    'pinned', false,
    'postedAt', now_ms,
    'postedBy', caller_email
  );

  -- The description guard trigger from secure_jobs.sql runs on this insert too,
  -- so contact details typed into the public description are still rejected.
  INSERT INTO public.vacancies (id, data, synced_at) VALUES (new_id, v_data, now());

  -- Notify every user, as the admin's own posts do.
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

  -- Only the fields the team needs to post and delete. Contact details, manager
  -- names and descriptions are not returned.
  RETURN QUERY
  SELECT jsonb_build_object(
      'id', v.id,
      'title', v.data ->> 'title',
      'company', v.data ->> 'company',
      'location', v.data ->> 'location',
      'category', v.data ->> 'category',
      'postedAt', CASE WHEN v.data ->> 'postedAt' ~ '^[0-9]{1,13}$' THEN (v.data ->> 'postedAt')::bigint ELSE 0 END,
      'postedBy', coalesce(v.data ->> 'postedBy', '')
    )
  FROM public.vacancies AS v
  WHERE coalesce(v.data ->> 'deleted', 'false') <> 'true'
  ORDER BY CASE WHEN v.data ->> 'postedAt' ~ '^[0-9]{1,13}$' THEN (v.data ->> 'postedAt')::bigint ELSE 0 END DESC
  LIMIT 500;
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_delete_vacancy(p_id text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  caller_email text := coalesce(auth.jwt() ->> 'email', '');
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  reason_text text := btrim(coalesce(p_reason, ''));
  current_row public.vacancies%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_vacancy_editor() OR public.is_app_admin()) THEN
    RAISE EXCEPTION 'Only a vacancy team account can delete vacancies.' USING ERRCODE = '42501';
  END IF;
  IF length(reason_text) < 5 OR length(reason_text) > 300 THEN
    RAISE EXCEPTION 'Give a reason for the deletion (5 to 300 characters).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_row FROM public.vacancies WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR coalesce(current_row.data ->> 'deleted', 'false') = 'true' THEN
    RAISE EXCEPTION 'This vacancy is already deleted or no longer exists.' USING ERRCODE = 'P0002';
  END IF;

  -- Tombstone, as the admin app does, but keep the title and company so the
  -- deletion stays readable in the activity log.
  UPDATE public.vacancies
  SET data = jsonb_build_object(
        'deleted', true,
        'deletedAt', now_ms,
        'deleteReason', reason_text,
        'deletedBy', caller_email,
        'title', coalesce(current_row.data ->> 'title', ''),
        'company', coalesce(current_row.data ->> 'company', ''),
        'category', coalesce(current_row.data ->> 'category', ''),
        'location', coalesce(current_row.data ->> 'location', '')
      ),
      synced_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.employee_post_vacancy(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.employee_list_vacancies() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.employee_delete_vacancy(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_post_vacancy(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_list_vacancies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_delete_vacancy(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
