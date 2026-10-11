-- MedRep Connect Pro: Supabase Auth + admin-only mirror schema.
-- Run in the Supabase SQL Editor. This script deliberately grants no anon
-- access to account data or mirror tables. Browser requests use the public
-- publishable/anon key together with a Supabase Auth access token; RLS remains
-- the final authorization boundary.

CREATE TABLE IF NOT EXISTS public.users (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vacancies (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plans (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.applications (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

-- Canonicalize Indian mobile numbers before uniqueness checks. Formatting,
-- spaces, a leading 0, and the +91 country prefix do not create new numbers.
CREATE OR REPLACE FUNCTION public.normalize_indian_phone(raw_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  digits text;
BEGIN
  IF raw_phone IS NULL OR btrim(raw_phone) = '' THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(raw_phone, '[^0-9]', '', 'g');
  IF length(digits) = 14 AND left(digits, 4) = '0091' THEN
    digits := substr(digits, 5);
  ELSIF length(digits) = 12 AND left(digits, 2) = '91' THEN
    digits := substr(digits, 3);
  ELSIF length(digits) = 11 AND left(digits, 1) = '0' THEN
    digits := substr(digits, 2);
  END IF;

  IF digits ~ '^[6-9][0-9]{9}$' THEN
    RETURN digits;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_indian_phone(text) FROM PUBLIC, anon, authenticated;

-- Auth identities are the source of truth. A trusted trigger maintains this
-- admin-readable projection; authenticated clients cannot insert, update, or
-- delete these rows directly. Phone uniqueness is enforced in PostgreSQL.
CREATE TABLE IF NOT EXISTS public.user_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  phone text,
  normalized_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  subscribed_until timestamptz,
  is_admin boolean NOT NULL DEFAULT false,
  CONSTRAINT user_accounts_normalized_phone_check
    CHECK (normalized_phone IS NULL OR normalized_phone ~ '^[6-9][0-9]{9}$')
);

ALTER TABLE public.user_accounts
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Refuse to silently merge two Auth accounts that resolve to the same mobile.
DO $$
BEGIN
  IF EXISTS (
    SELECT public.normalize_indian_phone(raw_user_meta_data ->> 'phone') AS normalized,
           count(*)
    FROM auth.users
    WHERE nullif(btrim(raw_user_meta_data ->> 'phone'), '') IS NOT NULL
      AND public.normalize_indian_phone(raw_user_meta_data ->> 'phone') IS NOT NULL
    GROUP BY public.normalize_indian_phone(raw_user_meta_data ->> 'phone')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate normalized mobile numbers exist in auth.users; resolve them before applying this schema.';
  END IF;
END
$$;

-- Backfill accounts created before the trigger was installed. Invalid legacy
-- phone strings are not treated as verified/unique numbers; the Auth trigger
-- rejects invalid values on the next profile update.
INSERT INTO public.user_accounts (
  user_id, email, name, phone, normalized_phone, created_at, is_admin
)
SELECT
  u.id,
  coalesce(u.email, ''),
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Job Seeker'
  ),
  public.normalize_indian_phone(u.raw_user_meta_data ->> 'phone'),
  public.normalize_indian_phone(u.raw_user_meta_data ->> 'phone'),
  u.created_at,
  coalesce((u.raw_app_meta_data ->> 'role') = 'admin', false)
    OR coalesce((u.raw_app_meta_data ->> 'is_admin') = 'true', false)
FROM auth.users AS u
ON CONFLICT (user_id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  normalized_phone = EXCLUDED.normalized_phone,
  is_admin = EXCLUDED.is_admin;

CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_normalized_phone_unique
  ON public.user_accounts (normalized_phone)
  WHERE normalized_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_user_status_idx
  ON public.payments ((data ->> 'userId'), (data ->> 'status'));
CREATE INDEX IF NOT EXISTS applications_job_applicant_idx
  ON public.applications ((data ->> 'jobId'), (data ->> 'applicantEmail'));
CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON public.support_tickets ((data ->> 'status'));
CREATE INDEX IF NOT EXISTS users_email_idx
  ON public.users ((data ->> 'email'));
CREATE INDEX IF NOT EXISTS vacancies_category_idx
  ON public.vacancies ((data ->> 'category'));

-- Only the trusted Auth app_metadata claim can grant administrator access.
-- user_metadata is editable by its owner and is never used for authorization.
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, auth
AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
      OR coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false)
$$;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

-- Auth signup/profile updates write the account projection as the database
-- owner. On deletion, the FK removes the account row and legacy mirrored
-- identity/profile rows are scrubbed by email. The app cannot invoke this
-- function directly; it is attached only as an auth.users trigger.
CREATE OR REPLACE FUNCTION public.sync_auth_user_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  raw_phone text;
  normalized_phone_value text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.users
      WHERE lower(data ->> 'email') = lower(coalesce(OLD.email, ''));
    DELETE FROM public.profiles
      WHERE lower(id) = lower(coalesce(OLD.email, ''));
    RETURN OLD;
  END IF;

  raw_phone := nullif(btrim(NEW.raw_user_meta_data ->> 'phone'), '');
  normalized_phone_value := public.normalize_indian_phone(raw_phone);
  IF raw_phone IS NOT NULL AND normalized_phone_value IS NULL THEN
    RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_accounts (
    user_id, email, name, phone, normalized_phone, created_at, is_admin
  ) VALUES (
    NEW.id,
    coalesce(NEW.email, ''),
    coalesce(
      nullif(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
      nullif(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
      'Job Seeker'
    ),
    normalized_phone_value,
    normalized_phone_value,
    NEW.created_at,
    coalesce((NEW.raw_app_meta_data ->> 'role') = 'admin', false)
      OR coalesce((NEW.raw_app_meta_data ->> 'is_admin') = 'true', false)
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    normalized_phone = EXCLUDED.normalized_phone,
    is_admin = EXCLUDED.is_admin;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_auth_user_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_auth_user_account ON auth.users;
DROP TRIGGER IF EXISTS sync_auth_user_account_update ON auth.users;
CREATE TRIGGER sync_auth_user_account
  AFTER INSERT OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_account();
CREATE TRIGGER sync_auth_user_account_update
  AFTER UPDATE OF email, raw_user_meta_data, raw_app_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_account();

-- Clear prior policies on the legacy mirror tables before installing the
-- canonical admin-only policy. This also removes the old `mirror_all` policy
-- that granted anon access. No policy on these tables grants anon access.
DO $$
DECLARE
  table_name text;
  policy_row record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users',
    'profiles',
    'vacancies',
    'plans',
    'payments',
    'support_tickets',
    'applications',
    'notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    FOR policy_row IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_row.policyname, table_name);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY authenticated_admin_all ON public.%I FOR ALL TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin())',
      table_name
    );
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
  END LOOP;
END
$$;

-- Account records are visible to verified admins only and are not directly
-- mutable/deletable by browser sessions, including admin sessions. Auth signup
-- is maintained by the trigger; account deletion goes through the guarded
-- admin-delete-user Edge Function.
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_accounts'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.user_accounts', policy_row.policyname);
  END LOOP;
END
$$;
CREATE POLICY authenticated_admin_read_accounts
  ON public.user_accounts FOR SELECT TO authenticated
  USING (public.is_app_admin());
REVOKE ALL ON public.user_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_accounts TO authenticated;

-- Dashboard projections must obey the calling user's RLS policies too.
CREATE OR REPLACE VIEW public.users_view WITH (security_invoker = true) AS
SELECT
  id,
  data ->> 'email' AS email,
  data ->> 'name' AS name,
  data ->> 'phone' AS phone,
  data ->> 'createdAt' AS created_at,
  data ->> 'subscribedUntil' AS subscribed_until,
  data ->> 'isAdmin' AS is_admin,
  data,
  synced_at
FROM public.users;

CREATE OR REPLACE VIEW public.payments_view WITH (security_invoker = true) AS
SELECT
  id,
  data ->> 'userId' AS user_id,
  data ->> 'planId' AS plan_id,
  data ->> 'amount' AS amount,
  data ->> 'status' AS status,
  data ->> 'createdAt' AS created_at,
  data ->> 'txRef' AS tx_ref,
  data ->> 'refundStatus' AS refund_status,
  data,
  synced_at
FROM public.payments;

CREATE OR REPLACE VIEW public.vacancies_view WITH (security_invoker = true) AS
SELECT
  id,
  data ->> 'title' AS title,
  data ->> 'company' AS company,
  data ->> 'category' AS category,
  data ->> 'location' AS location,
  data ->> 'postedAt' AS posted_at,
  data ->> 'deleted' AS deleted,
  data ->> 'deletedAt' AS deleted_at,
  data,
  synced_at
FROM public.vacancies;

CREATE OR REPLACE VIEW public.applications_view WITH (security_invoker = true) AS
SELECT
  id,
  data ->> 'jobId' AS job_id,
  data ->> 'jobTitle' AS job_title,
  data ->> 'applicantName' AS applicant_name,
  data ->> 'applicantEmail' AS applicant_email,
  data ->> 'channel' AS channel,
  data ->> 'sentAt' AS sent_at,
  data,
  synced_at
FROM public.applications;

REVOKE ALL ON public.users_view, public.payments_view, public.vacancies_view, public.applications_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.users_view, public.payments_view, public.vacancies_view, public.applications_view TO authenticated;

-- Promote an administrator only through trusted app_metadata. After setting
-- this claim, the admin must sign out and back in to refresh the access token.
-- Example (replace the address with the provisioned Auth account):
-- UPDATE auth.users
-- SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
-- WHERE lower(email) = lower('admin@example.com');
