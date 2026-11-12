-- Match the production vacancy_employee_limit_50 migration.
-- Run AFTER vacancy_team.sql. The INSERT trigger serializes concurrent writes,
-- so the 50-login cap is enforced even if an admin function is bypassed.

BEGIN;

DROP INDEX IF EXISTS public.vacancy_employees_single_login;

CREATE OR REPLACE FUNCTION public.enforce_vacancy_employee_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(1836016749, 50);
  IF (SELECT count(*) FROM public.vacancy_employees) >= 50 THEN
    RAISE EXCEPTION 'Maximum of 50 vacancy employee logins reached.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_vacancy_employee_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS vacancy_employees_enforce_limit ON public.vacancy_employees;
CREATE TRIGGER vacancy_employees_enforce_limit
  BEFORE INSERT ON public.vacancy_employees
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vacancy_employee_limit();

COMMIT;
