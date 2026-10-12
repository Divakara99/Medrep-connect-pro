-- Run AFTER schema.sql and payments.sql in the SAME Supabase project as the app.
-- The raw JSONB vacancy table stays admin-only under schema.sql's RLS policy.
-- Only this explicitly shaped RPC can be called by ordinary signed-in users.
-- Do not add user SELECT policies on vacancies or vacancies_view: those expose
-- the entire data JSONB (including contact details).

BEGIN;
-- The same trusted-role + verified-TOTP requirement protects every admin-only
-- table policy from schema.sql, not just vacancies. An aal1 password session
-- may enroll MFA in Supabase Auth but cannot read/write admin data.
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, auth
AS $$
  SELECT (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    OR coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false)
  ) AND coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
$$;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
-- Reapply an admin-only raw-table policy, replacing any legacy permissive one.
DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vacancies'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.vacancies', policy_row.policyname);
  END LOOP;
END
$$;
CREATE POLICY authenticated_admin_all ON public.vacancies
  FOR ALL TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
REVOKE ALL ON public.vacancies FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vacancies TO authenticated;
ALTER VIEW public.vacancies_view SET (security_invoker = true);
REVOKE ALL ON public.vacancies_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vacancies_view TO authenticated;

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

  -- Read the authoritative expiry at query time. Client-provided roles,
  -- subscription flags and localStorage never control access.
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
      'pinned', coalesce((v.data ->> 'pinned')::boolean, false),
      'postedAt', coalesce((v.data ->> 'postedAt')::bigint, 0)
    ) || CASE WHEN can_view_private THEN
      jsonb_build_object(
        'company', v.data ->> 'company',
        'manager', v.data ->> 'manager',
        'contact', v.data ->> 'contact',
        'managerAltPhone', v.data ->> 'managerAltPhone',
        'managerEmail', v.data ->> 'managerEmail',
        'hq', v.data ->> 'hq',
        'division', v.data ->> 'division',
        'description', v.data ->> 'description'
      ) ELSE '{}'::jsonb END
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
