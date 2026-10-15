-- Company-name unlocks earned with a rewarded video (Android app, AdMob).
-- Run AFTER schema.sql, secure_jobs.sql and vacancy_duplicate_check.sql in the
-- SAME Supabase project. Safe to re-run.
--
-- Rules enforced here:
--   * One completed rewarded video unlocks ONE job's company name, forever.
--   * Unlock rows are written ONLY by the admob-reward-verification Edge
--     Function (service role) after Google's server-side verification (SSV)
--     signature check. Signed-in users can read only their own rows; the
--     browser can never insert, update or delete an unlock.
--   * transaction_id is UNIQUE: Google's SSV callback is de-duplicated in the
--     table itself, so a replayed callback can never double-grant.
--   * list_visible_jobs() returns `company` + `companyUnlocked` for unlocked
--     jobs. The other four confidential fields (manager, manager email,
--     contact, alternate number) stay subscriber-only, exactly as before.

BEGIN;

CREATE TABLE IF NOT EXISTS public.company_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  job_id text NOT NULL,
  transaction_id text NOT NULL,
  ad_unit_id text NOT NULL DEFAULT '',
  reward_amount integer,
  reward_item text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_unlocks_transaction_unique UNIQUE (transaction_id),
  CONSTRAINT company_unlocks_user_job_unique UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS company_unlocks_user_idx
  ON public.company_unlocks (user_id, job_id);

ALTER TABLE public.company_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_unlocks_read_own ON public.company_unlocks;
CREATE POLICY company_unlocks_read_own ON public.company_unlocks
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.company_unlocks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_unlocks TO authenticated;
GRANT ALL ON public.company_unlocks TO service_role;

-- Latest list_visible_jobs(): identical to vacancy_duplicate_check.sql, plus
-- the per-job company unlock. Keep both files' copies in sync (this header,
-- and the copy in vacancy_duplicate_check.sql, say so in both places).
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
        WHERE cu.user_id = auth.uid() AND cu.job_id = v.id
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
        SELECT 1 FROM public.company_unlocks AS cu
        WHERE cu.user_id = auth.uid() AND cu.job_id = v.id
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
