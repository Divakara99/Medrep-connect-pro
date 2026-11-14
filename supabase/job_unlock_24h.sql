-- New ₹5 single-job unlocks last 24 hours. Run AFTER
-- supabase/vacancy_extra_fields.sql and deploy verify-job-unlock afterward.
-- Existing paid unlocks are deliberately left untouched (grandfathered).
-- Safe to re-run.

BEGIN;

-- The previous migration installed a trigger that forced every paid unlock to
-- infinity. Remove that policy before adding the new 24-hour rule.
DROP TRIGGER IF EXISTS job_unlocks_permanent ON public.job_unlocks;
DROP FUNCTION IF EXISTS public.job_unlocks_force_permanent();
ALTER TABLE public.job_unlocks ALTER COLUMN expires_at DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.job_unlocks_set_24h_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Set the expiry once, exactly when a pending payment becomes paid. Never
  -- extend an existing unlock on a later update, and do not rewrite old paid
  -- rows, which remain permanent as already promised.
  IF NEW.payment_status = 'paid'
    AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid') THEN
    NEW.paid_at := coalesce(NEW.paid_at, now());
    NEW.expires_at := NEW.paid_at + interval '24 hours';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_unlocks_24h ON public.job_unlocks;
CREATE TRIGGER job_unlocks_24h
  BEFORE INSERT OR UPDATE ON public.job_unlocks
  FOR EACH ROW EXECUTE FUNCTION public.job_unlocks_set_24h_expiry();

NOTIFY pgrst, 'reload schema';
COMMIT;
