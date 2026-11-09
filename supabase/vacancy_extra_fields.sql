-- Extra vacancy details: fields the administrator created.
--
-- A vacancy can carry "Territory: Hubballi North" or "Joining: Immediate"
-- without a schema change — the row is jsonb, so those live in
-- data.extraFields as [{label, value}]. They are public, like salary and
-- experience, and they are safe to be: the form refuses a phone number or an
-- email address in one (see src/data/extraFields.ts).
--
-- Nothing else about the projection changes: the five contact fields are still
-- released only to a pass holder or a ₹5 unlock, on this job, by this server.
--
-- Run after supabase/job_unlock_permanent.sql (this replaces its version).

BEGIN;

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
      -- The administrator's own fields. Public by design; the array is
      -- already filtered when it is saved, and any row written before this
      -- migration simply has none.
      'extraFields', CASE
        WHEN jsonb_typeof(v.data -> 'extraFields') = 'array' THEN v.data -> 'extraFields'
        ELSE '[]'::jsonb
      END,
      'pinned', coalesce((v.data ->> 'pinned')::boolean, false),
      'postedAt', coalesce((v.data ->> 'postedAt')::bigint, 0),
      'companyUnlocked', EXISTS (
        SELECT 1 FROM public.company_unlocks AS cu
        WHERE cu.user_id = auth.uid() AND cu.job_id = v.id AND cu.expires_at > now()
      ),
      'unlockExpiresAt', (
        SELECT max(cu.expires_at)::text FROM public.company_unlocks AS cu
        WHERE cu.user_id = auth.uid() AND cu.job_id = v.id AND cu.expires_at > now()
      ),
      'jobUnlocked', EXISTS (
        SELECT 1 FROM public.job_unlocks AS ju
        WHERE ju.user_id = auth.uid() AND ju.job_id = v.id
          AND ju.payment_status = 'paid' AND ju.expires_at > now()
      ),
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

REVOKE ALL ON FUNCTION public.list_visible_jobs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_visible_jobs() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
