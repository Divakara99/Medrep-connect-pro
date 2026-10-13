-- Administrator sign-in code: ON / OFF switch.
-- Run AFTER schema.sql, payments.sql, secure_jobs.sql and admin_access.sql in
-- the SAME Supabase project as the app. Safe to re-run.
--
-- What the switch means
--   ON  (default, and the state of every existing project): admin data requires
--       a session whose authenticator assurance level is `aal2`, i.e. the
--       six-digit code from the authenticator app was verified by Supabase Auth.
--   OFF : an administrator who signed in with email + password alone can read
--       the admin console (aal1 is accepted).
--
-- The setting lives in public.app_settings (server side, no client access at
-- all) and is read by public.is_app_admin(), which every admin-only RLS policy
-- and every admin Edge Function uses — so the switch is enforced by the
-- database, not by the browser. Flipping it is itself admin-only and every
-- change is written to public.app_settings_audit with the email and the code
-- state of whoever changed it.
--
-- SECURITY NOTE (read before switching OFF): with the code off, the admin
-- password alone is enough to read all admin data from any device. Turn it back
-- ON as soon as the temporary need is over.

BEGIN;

-- Internal settings. No RLS policy is created on purpose: the table is readable
-- and writable only through the SECURITY DEFINER functions below.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_settings FROM PUBLIC, anon, authenticated;

-- Internal read. Fails safe: anything missing, unreadable or malformed counts
-- as "the code is required".
CREATE OR REPLACE FUNCTION public.admin_mfa_required()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    (SELECT (s.value ->> 'required') = 'true'
       FROM public.app_settings AS s
      WHERE s.key = 'admin_mfa'),
    true
  )
$$;
REVOKE ALL ON FUNCTION public.admin_mfa_required() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mfa_required() TO anon, authenticated, service_role;

-- The single authorization predicate for admin data. Role claim comes from the
-- verified JWT's app_metadata (never user_metadata); the second factor is either
-- a verified authenticator session OR the owner's explicit OFF switch.
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth, public
AS $$
  SELECT (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    OR coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false)
  ) AND (
    coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
    OR public.admin_mfa_required() = false
  )
$$;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

-- Audit trail of every switch change. Administrators can read it in the console.
CREATE TABLE IF NOT EXISTS public.app_settings_audit (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  value jsonb NOT NULL,
  changed_by text,
  changed_aal text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_read_app_settings_audit ON public.app_settings_audit;
CREATE POLICY admin_read_app_settings_audit ON public.app_settings_audit
  FOR SELECT TO authenticated USING (public.is_app_admin());
REVOKE ALL ON public.app_settings_audit FROM PUBLIC, anon;
GRANT SELECT ON public.app_settings_audit TO authenticated;

-- Everything the admin console needs to describe the current security state:
-- whether the code is required, whether THIS session satisfied it, and who last
-- changed the switch.
CREATE OR REPLACE FUNCTION public.admin_security_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth, public
AS $$
  SELECT jsonb_build_object(
    'mfaRequired', public.admin_mfa_required(),
    'mfaVerified', coalesce(auth.jwt() ->> 'aal' = 'aal2', false),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'isAdmin', public.is_app_admin(),
    'changedBy', (SELECT s.updated_by FROM public.app_settings AS s WHERE s.key = 'admin_mfa'),
    'changedAt', (SELECT s.updated_at FROM public.app_settings AS s WHERE s.key = 'admin_mfa')
  )
$$;
REVOKE ALL ON FUNCTION public.admin_security_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_security_state() TO authenticated;

-- Flip the switch. Only an administrator may: when the code is ON that means an
-- `aal2` session, and when it is OFF the password-only admin session can turn it
-- back on — which is exactly how the owner recovers if they lose the app.
CREATE OR REPLACE FUNCTION public.set_admin_mfa_required(p_required boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth, public
AS $$
DECLARE
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_aal text := coalesce(auth.jwt() ->> 'aal', 'aal1');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in as an administrator to change the sign-in code setting.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only an administrator can change the sign-in code setting.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.app_settings (key, value, updated_at, updated_by)
  VALUES ('admin_mfa', jsonb_build_object('required', coalesce(p_required, true)), now(), v_email)
  ON CONFLICT (key) DO UPDATE
    SET value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  INSERT INTO public.app_settings_audit (key, value, changed_by, changed_aal)
  VALUES ('admin_mfa', jsonb_build_object('required', coalesce(p_required, true)), v_email, v_aal);

  RETURN public.admin_security_state();
END;
$$;
REVOKE ALL ON FUNCTION public.set_admin_mfa_required(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_mfa_required(boolean) TO authenticated;

-- Read-only helper used by the admin portal to explain why a request was
-- refused. Returns the trusted facts from the verified token only; no
-- user-editable user_metadata is consulted.
CREATE OR REPLACE FUNCTION public.current_admin_session()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth, public
AS $$
  SELECT jsonb_build_object(
    'userId', auth.uid(),
    'hasAdminRole', coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
      OR coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'mfaVerified', coalesce(auth.jwt() ->> 'aal' = 'aal2', false),
    'mfaRequired', public.admin_mfa_required(),
    'isAdmin', public.is_app_admin()
  )
$$;
REVOKE ALL ON FUNCTION public.current_admin_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_admin_session() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
