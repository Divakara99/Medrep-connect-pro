-- Paid single-job unlock: ₹5 for the full contact details of ONE vacancy,
-- visible for 1 hour. Run AFTER schema.sql, secure_jobs.sql,
-- vacancy_duplicate_check.sql and company_unlocks.sql in the SAME Supabase
-- project. Safe to re-run (idempotent).
--
-- Rules enforced here:
--   * One payment buys ONE job for 1 hour (JOB_UNLOCK_INTERVAL below). After it
--     lapses the five confidential fields are withdrawn again and the job can
--     be bought again — nothing is permanent, nothing auto-renews.
--   * The price is pinned at 500 paise by a CHECK constraint. The browser never
--     sends an amount: create-job-unlock-order prices the Razorpay order at 500
--     paise and verify-job-unlock refuses any captured payment whose amount is
--     not exactly 500.
--   * Rows are written ONLY by the Edge Functions, with the service role:
--     create-job-unlock-order inserts a `pending` row, verify-job-unlock marks
--     it `paid` and stamps expires_at = now() + 1 hour. Signed-in users can
--     read only their own rows; there is no insert/update/delete grant for
--     them, so a browser can never grant itself an unlock.
--   * razorpay_order_id and razorpay_payment_id are UNIQUE, so a replayed
--     confirmation cannot buy a second hour from the same payment.
--   * list_visible_jobs() (below) is the function that actually decides what a
--     paid unlock reveals. This file owns the newest copy; keep it in step with
--     the copies in vacancy_duplicate_check.sql and company_unlocks.sql, and
--     run this file last.

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  job_id text NOT NULL,
  amount_paise integer NOT NULL DEFAULT 500,
  razorpay_order_id text NOT NULL,
  razorpay_payment_id text,
  payment_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  -- Null until the payment is verified. list_visible_jobs() requires both a
  -- paid row and expires_at > now(), so a pending row reveals nothing.
  expires_at timestamptz,
  CONSTRAINT job_unlocks_order_unique UNIQUE (razorpay_order_id),
  CONSTRAINT job_unlocks_payment_unique UNIQUE (razorpay_payment_id),
  CONSTRAINT job_unlocks_price_fixed CHECK (amount_paise = 500),
  CONSTRAINT job_unlocks_status_valid
    CHECK (payment_status IN ('pending', 'paid', 'failed'))
);

CREATE INDEX IF NOT EXISTS job_unlocks_user_job_idx
  ON public.job_unlocks (user_id, job_id, expires_at);

ALTER TABLE public.job_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_unlocks_read_own ON public.job_unlocks;
CREATE POLICY job_unlocks_read_own ON public.job_unlocks
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.job_unlocks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.job_unlocks TO authenticated;
GRANT ALL ON public.job_unlocks TO service_role;

-- Newest list_visible_jobs(): identical to company_unlocks.sql, plus the paid
-- per-job unlock. Projection order matters —
--   1. an active pass: all five confidential fields, every job;
--   2. a paid ₹5 unlock: all five confidential fields, that ONE job, 1 hour;
--   3. a rewarded-video unlock: the company name only, that one job, 10 min;
--   4. otherwise: none of the five.
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
      'jobUnlockExpiresAt', (
        SELECT max(ju.expires_at)::text FROM public.job_unlocks AS ju
        WHERE ju.user_id = auth.uid() AND ju.job_id = v.id
          AND ju.payment_status = 'paid' AND ju.expires_at > now()
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

REVOKE ALL ON FUNCTION public.list_visible_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_visible_jobs() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
