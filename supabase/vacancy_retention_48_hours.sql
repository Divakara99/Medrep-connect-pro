-- Deleted vacancies stay restorable for 48 hours, then their full row is
-- permanently removed. The small audit summary remains for accountability.
-- Run after vacancy_restore.sql and role_position_manual_entry.sql.

BEGIN;

-- Keep restore/deletion audit snapshots consistent with Role/Position and keep
-- the existing "restored" audit action introduced by vacancy_restore.sql.
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

  IF NOT was_deleted AND is_deleted THEN
    reason_value := nullif(btrim(coalesce(NEW.data ->> 'deleteReason', '')), '');
    INSERT INTO public.vacancy_audit
      (action, vacancy_id, title, company, category, role_position, location, actor_role, actor_email, reason)
    VALUES
      ('deleted', NEW.id,
       coalesce(OLD.data ->> 'title', ''), coalesce(OLD.data ->> 'company', ''),
       coalesce(OLD.data ->> 'category', ''), coalesce(OLD.data ->> 'rolePosition', ''),
       coalesce(OLD.data ->> 'location', ''), actor_role_value, actor_email_value,
       coalesce(reason_value, 'No reason recorded'));
  ELSIF was_deleted AND NOT is_deleted THEN
    INSERT INTO public.vacancy_audit
      (action, vacancy_id, title, company, category, role_position, location, actor_role, actor_email)
    VALUES
      ('restored', NEW.id,
       coalesce(NEW.data ->> 'title', ''), coalesce(NEW.data ->> 'company', ''),
       coalesce(NEW.data ->> 'category', ''), coalesce(NEW.data ->> 'rolePosition', ''),
       coalesce(NEW.data ->> 'location', ''), actor_role_value, actor_email_value);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_vacancy_audit() FROM PUBLIC, anon, authenticated;

-- Return the most recent deletion time, falling back to the audit log for
-- older tombstones that do not carry deletedAt in their JSON body.
CREATE OR REPLACE FUNCTION public.vacancy_deleted_at_ms(p_id text, p_data jsonb)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN coalesce(p_data ->> 'deletedAt', '') ~ '^[0-9]{1,13}$'
      THEN (p_data ->> 'deletedAt')::bigint
    ELSE (
      SELECT floor(extract(epoch FROM va.created_at) * 1000)::bigint
      FROM public.vacancy_audit AS va
      WHERE va.vacancy_id = p_id AND va.action = 'deleted'
      ORDER BY va.created_at DESC
      LIMIT 1
    )
  END
$$;
REVOKE ALL ON FUNCTION public.vacancy_deleted_at_ms(text, jsonb) FROM PUBLIC, anon, authenticated;

-- This function is only callable by the scheduled job/service role. It removes
-- the vacancy row but deliberately leaves the restricted audit summary intact.
CREATE OR REPLACE FUNCTION public.purge_expired_deleted_vacancies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  removed integer;
  cutoff_ms bigint := floor(extract(epoch FROM (statement_timestamp() - interval '48 hours')) * 1000)::bigint;
BEGIN
  DELETE FROM public.vacancies AS v
  WHERE coalesce(v.data ->> 'deleted', 'false') = 'true'
    AND public.vacancy_deleted_at_ms(v.id, v.data) <= cutoff_ms;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_expired_deleted_vacancies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_deleted_vacancies() TO service_role;

-- Restore checks the same 48-hour deadline in the database, so a stale client
-- cannot bypass it. At the exact 48-hour boundary the restore is closed.
CREATE OR REPLACE FUNCTION public.restore_vacancy(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  deleted_at_ms bigint;
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

  deleted_at_ms := public.vacancy_deleted_at_ms(current_row.id, current_row.data);
  IF deleted_at_ms IS NULL OR deleted_at_ms > now_ms OR deleted_at_ms <= now_ms - 172800000 THEN
    RAISE EXCEPTION 'The 48-hour restore period has ended. This vacancy will be permanently removed.' USING ERRCODE = 'P0002';
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

-- pg_cron is available on Supabase; reschedule idempotently to ensure old
-- installs also pick up the 48-hour rule.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
DO $$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'purge-expired-vacancies';
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
  PERFORM cron.schedule(
    'purge-expired-vacancies',
    '*/5 * * * *',
    'SELECT public.purge_expired_deleted_vacancies();'
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
