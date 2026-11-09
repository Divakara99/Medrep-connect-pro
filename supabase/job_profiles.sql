-- Job-seeker profiles live ONLINE, one row per signed-in account.
-- Run AFTER schema.sql. Safe to re-run.
--
-- Why this exists: the profile used to be kept in the browser's localStorage
-- and only mirrored into admin-controlled tables, so a cleared browser or a new
-- phone silently lost it. This table is the single home of a candidate's
-- profile — name-adjacent details, education, experience, bio — and the browser
-- keeps only an in-memory copy for the current session.
--
-- Rules:
--   * One row per auth user, keyed by auth.users.id. Reading or writing another
--     row is impossible: RLS compares user_id with auth.uid() on every statement.
--   * `email` is stamped by the app for support/identification; it is not used
--     as the key, so changing an email never orphans a profile.
--   * `data` is the profile JSON exactly as the app models it (Profile type).
--     Nothing here is a payment record, entitlement or contact unlock — those
--     live in their own tables and keep their own rules.

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_profiles_read_own ON public.job_profiles;
CREATE POLICY job_profiles_read_own ON public.job_profiles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS job_profiles_insert_own ON public.job_profiles;
CREATE POLICY job_profiles_insert_own ON public.job_profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS job_profiles_update_own ON public.job_profiles;
CREATE POLICY job_profiles_update_own ON public.job_profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.job_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.job_profiles TO authenticated;
GRANT ALL ON public.job_profiles TO service_role;

-- Admins can read a profile for support (they already read every account), but
-- the app never writes anybody else's row.
DROP POLICY IF EXISTS job_profiles_admin_read ON public.job_profiles;
CREATE POLICY job_profiles_admin_read ON public.job_profiles
  FOR SELECT TO authenticated
  USING (public.is_app_admin());

NOTIFY pgrst, 'reload schema';
COMMIT;
