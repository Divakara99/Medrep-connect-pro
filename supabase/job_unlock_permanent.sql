-- The ₹5 single-job unlock is bought ONCE PER JOB and stays open.
--
-- It used to run for one hour: the contact block was withdrawn at expiry and
-- the same job could be bought again. That charged the same person repeatedly
-- for the same vacancy. A paid unlock is now permanent for that job — the row's
-- expires_at is 'infinity' and list_visible_jobs() keeps revealing the five
-- confidential fields for as long as the row exists.
--
-- Run AFTER supabase/job_unlocks.sql. Safe to re-run.
--
-- What changes:
--   * new rows default to 'infinity' (the Edge Function also writes it);
--   * unlocks already paid for stop counting down instead of lapsing;
--   * list_visible_jobs() reports jobUnlockExpiresAt = NULL for a permanent
--     unlock, so the app shows "unlocked for this job" and no timer.
--
-- The price (500 paise) and the verification rules are untouched, and a pending
-- row still reveals nothing.

BEGIN;

ALTER TABLE public.job_unlocks
  ALTER COLUMN expires_at SET DEFAULT 'infinity'::timestamptz;

-- Honour the promise already made to anyone who paid under the hourly rule.
UPDATE public.job_unlocks
  SET expires_at = 'infinity'::timestamptz
  WHERE payment_status = 'paid'
    AND (expires_at IS NULL OR expires_at < 'infinity'::timestamptz);

-- Enforce it at the row level, so no caller — including an older deployed
-- Edge Function that still computes "now + 60 minutes" — can hand someone an
-- unlock that lapses.
CREATE OR REPLACE FUNCTION public.job_unlocks_force_permanent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.payment_status = 'paid' THEN
    NEW.expires_at := 'infinity'::timestamptz;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_unlocks_permanent ON public.job_unlocks;
CREATE TRIGGER job_unlocks_permanent
  BEFORE INSERT OR UPDATE ON public.job_unlocks
  FOR EACH ROW EXECUTE FUNCTION public.job_unlocks_force_permanent();

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
      'postedAt', coalesce((v.data ->> 'postedAt')::bigint, 0),
      -- True when this job's company name is visible to THIS user without a
      -- subscription (rewarded-video unlock). Subscribers see every company,
      -- which the client derives from its subscription flag; this field is
      -- the per-job unlock only, so the two never get conflated.
      'companyUnlocked', EXISTS (
        SELECT 1 FROM public.company_unlocks AS cu
        WHERE cu.user_id = auth.uid() AND cu.job_id = v.id AND cu.expires_at > now()
      ),
      -- Drives the countdown in the app ("9 min left"). The server decides
      -- visibility on every read, so a stale client clock can never extend it.
      'unlockExpiresAt', (
        SELECT max(cu.expires_at)::text FROM public.company_unlocks AS cu
        WHERE cu.user_id = auth.uid() AND cu.job_id = v.id AND cu.expires_at > now()
      ),
      -- Paid ₹5 unlock: the whole contact block for this job, for one hour.
      'jobUnlocked', EXISTS (
        SELECT 1 FROM public.job_unlocks AS ju
        WHERE ju.user_id = auth.uid() AND ju.job_id = v.id
          AND ju.payment_status = 'paid' AND ju.expires_at > now()
      ),
      -- NULL means "this job is unlocked for good": a permanent row is stored
      -- as 'infinity', which the app must not render as a countdown.
      'jobUnlockExpiresAt', (
        SELECT max(ju.expires_at)::text FROM public.job_unlocks AS ju
        WHERE ju.user_id = auth.uid() AND ju.job_id = v.id
          AND ju.payment_status = 'paid' AND ju.expires_at > now()
          AND ju.expires_at < 'infinity'::timestamptz
      )
    ) || CASE
      WHEN can_view_private THEN
        jsonb_build_object(
          'company', v.data ->> 'company',
          'manager', v.data ->> 'manager',
          'contact', v.data ->> 'contact',
          'managerAltPhone', v.data ->> 'managerAltPhone',
          'managerEmail', v.data ->> 'managerEmail'
        )
      WHEN EXISTS (
        SELECT 1 FROM public.job_unlocks AS ju
        WHERE ju.user_id = auth.uid() AND ju.job_id = v.id
          AND ju.payment_status = 'paid' AND ju.expires_at > now()
      ) THEN
        -- Paid single-job unlock: same five fields a pass would reveal, for
        -- this job only, while the hour runs.
        jsonb_build_object(
          'company', v.data ->> 'company',
          'manager', v.data ->> 'manager',
          'contact', v.data ->> 'contact',
          'managerAltPhone', v.data ->> 'managerAltPhone',
          'managerEmail', v.data ->> 'managerEmail'
        )
      WHEN EXISTS (
        SELECT 1 FROM public.company_unlocks AS cu
        WHERE cu.user_id = auth.uid() AND cu.job_id = v.id AND cu.expires_at > now()
      ) THEN
        -- Unlocked by video: the company name only. The other four fields
        -- are still not sent at all.
        jsonb_build_object('company', v.data ->> 'company')
      ELSE '{}'::jsonb
    END
  FROM public.vacancies AS v
  WHERE coalesce(v.data ->> 'deleted', 'false') <> 'true'
  ORDER BY coalesce((v.data ->> 'pinned')::boolean, false) DESC,
           coalesce((v.data ->> 'postedAt')::bigint, 0) DESC
  LIMIT 500;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
