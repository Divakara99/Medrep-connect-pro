-- Restore/confirm the TOTP (authenticator) requirement for administrator access.
-- Run AFTER schema.sql, payments.sql, secure_jobs.sql and admin_access.sql in
-- the SAME Supabase project as the app. Safe to re-run.
--
-- Why this file exists: an earlier release replaced the authenticator step with
-- a fixed 4-digit app access code. That code shipped inside the public browser
-- bundle, so it was readable by anyone and could not authorize anything. This
-- migration puts the real second factor back:
--
--   is_app_admin() = trusted app_metadata.role = 'admin'  AND  auth.jwt().aal = 'aal2'
--
-- `aal2` is only present in a Supabase Auth access token after the user has
-- verified a TOTP challenge for the current session. It is issued by Supabase
-- Auth, not by the app, so the browser cannot forge it.
--
-- Operational prerequisite (Supabase Dashboard):
--   Authentication → Providers/Attack Protection → enable TOTP MFA, and allow
--   `aal2` sessions. The admin enrols an authenticator from the admin portal.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, auth
AS $$
  SELECT (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    OR coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false)
  ) AND coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
$$;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

-- Read-only helper used by the admin portal to explain why a request was
-- refused. Returns the trusted facts from the verified token only; no
-- user-editable user_metadata is consulted.
CREATE OR REPLACE FUNCTION public.current_admin_session()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, auth, public
AS $$
  SELECT jsonb_build_object(
    'userId', auth.uid(),
    'hasAdminRole', coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
      OR coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'mfaVerified', coalesce(auth.jwt() ->> 'aal' = 'aal2', false),
    'isAdmin', public.is_app_admin()
  )
$$;
REVOKE ALL ON FUNCTION public.current_admin_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_admin_session() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
