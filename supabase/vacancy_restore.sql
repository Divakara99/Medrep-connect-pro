-- Restoring a deleted vacancy, for real.
--
-- Why this file exists: the Undo button in the admin panel only worked while
-- the tombstone still carried the vacancy. Two paths broke that:
--
--   * `employee_delete_vacancy()` rebuilt the row from eight fields, throwing
--     away the description, salary, contact and every other column;
--   * any client that predates the tombstone change wrote `{deleted: true}` on
--     its own and lost the rest.
--
-- Six of the seven tombstones in production are like that: an id, a time and a
-- reason, and nothing to bring back. Undo was offered and could never work.
--
-- After this migration a delete can never lose the body again, whatever writes
-- it, and restoring is one audited server call instead of a client-side update.
--
-- Run after supabase/vacancy_team.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A tombstone keeps the whole row.
--    BEFORE UPDATE, so it also covers a stale client that sends only the
--    flag: the old body is merged back underneath the new tombstone fields.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vacancies_keep_body()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(OLD.data ->> 'deleted', 'false') <> 'true'
     AND coalesce(NEW.data ->> 'deleted', 'false') = 'true' THEN
    NEW.data := OLD.data || NEW.data;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.vacancies_keep_body() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vacancies_keep_body ON public.vacancies;
CREATE TRIGGER vacancies_keep_body
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION public.vacancies_keep_body();

-- ---------------------------------------------------------------------------
-- 2. The team delete says what it means: tombstone flags over the old body.
-- ---------------------------------------------------------------------------
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

  -- Keep the whole vacancy so it can be restored; only the flags change.
  UPDATE public.vacancies
  SET data = current_row.data || jsonb_build_object(
        'deleted', true,
        'deletedAt', now_ms,
        'deleteReason', reason_text,
        'deletedBy', caller_email
      ),
      synced_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END;
$$;
REVOKE ALL ON FUNCTION public.employee_delete_vacancy(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_delete_vacancy(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The audit log learns to say "restored".
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.vacancy_audit'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%action%'
  LOOP
    EXECUTE format('ALTER TABLE public.vacancy_audit DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END
$$;
ALTER TABLE public.vacancy_audit
  ADD CONSTRAINT vacancy_audit_action_check
  CHECK (action IN ('added', 'deleted', 'restored'));
ALTER TABLE public.vacancy_audit
  ADD CONSTRAINT vacancy_audit_reason_check
  CHECK (action IN ('added', 'restored') OR (reason IS NOT NULL AND btrim(reason) <> ''));

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
  was_deleted boolean := coalesce(OLD.data ->> 'deleted', 'false') = 'true';
  is_deleted boolean := coalesce(NEW.data ->> 'deleted', 'false') = 'true';
BEGIN
  actor_role_value := CASE
    WHEN public.is_app_admin() THEN 'admin'
    WHEN public.is_vacancy_editor() THEN 'vacancy_editor'
    ELSE 'system'
  END;

  IF TG_OP = 'INSERT' THEN
    IF NOT coalesce(NEW.data ->> 'deleted', 'false') = 'true' THEN
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

  IF NOT was_deleted AND is_deleted THEN
    reason_value := nullif(btrim(coalesce(NEW.data ->> 'deleteReason', '')), '');
    INSERT INTO public.vacancy_audit
      (action, vacancy_id, title, company, category, location, actor_role, actor_email, reason)
    VALUES
      ('deleted', NEW.id,
       coalesce(OLD.data ->> 'title', ''), coalesce(OLD.data ->> 'company', ''),
       coalesce(OLD.data ->> 'category', ''), coalesce(OLD.data ->> 'location', ''),
       actor_role_value, actor_email_value,
       coalesce(reason_value, 'No reason recorded'));
  ELSIF was_deleted AND NOT is_deleted THEN
    INSERT INTO public.vacancy_audit
      (action, vacancy_id, title, company, category, location, actor_role, actor_email, reason)
    VALUES
      ('restored', NEW.id,
       coalesce(NEW.data ->> 'title', ''), coalesce(NEW.data ->> 'company', ''),
       coalesce(NEW.data ->> 'category', ''), coalesce(NEW.data ->> 'location', ''),
       actor_role_value, actor_email_value, NULL);
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
-- 4. Restore, on the server, checked and audited.
--    Refuses a tombstone with no body (an old delete) with a clear message,
--    instead of bringing back an empty card.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_vacancy(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  current_row public.vacancies%ROWTYPE;
  restored jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_app_admin() OR public.is_vacancy_editor()) THEN
    RAISE EXCEPTION 'Only an administrator can restore a deleted vacancy.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_id), '') = '' THEN
    RAISE EXCEPTION 'Choose the vacancy to restore.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_row FROM public.vacancies WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That vacancy no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(current_row.data ->> 'deleted', 'false') <> 'true' THEN
    RAISE EXCEPTION 'That vacancy is already live.' USING ERRCODE = 'P0002';
  END IF;

  restored := current_row.data
    - 'deleted' - 'deletedAt' - 'deleteReason' - 'deletedBy'
    || jsonb_build_object('restoredAt', now_ms);

  IF coalesce(btrim(restored ->> 'title'), '') = ''
     OR coalesce(btrim(restored ->> 'location'), '') = ''
     OR coalesce(btrim(restored ->> 'category'), '') = '' THEN
    RAISE EXCEPTION 'This vacancy was deleted before its details were kept, so it cannot be restored. Post it again instead.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.vacancies SET data = restored, synced_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'title', restored ->> 'title');
END;
$$;
REVOKE ALL ON FUNCTION public.restore_vacancy(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_vacancy(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
