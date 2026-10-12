-- Manual access grants + the 'manual_grant' payment method.
-- Run AFTER schema.sql, payments.sql and secure_jobs.sql in the SAME Supabase
-- project as the app.
--
-- 1. The administrator gate keeps BOTH requirements: the trusted admin ROLE
--    claim AND a verified authenticator (TOTP) step, i.e. an `aal2` JWT. A
--    password-only (aal1) session cannot read or write admin data. Enable TOTP
--    MFA in Supabase Auth settings; the app's admin portal enrols and verifies
--    the authenticator before it shows any data.
-- 2. grant_manual_access lets an admin grant special user access (e.g. a free
--    15-day run) with a full audit row in subscription_payments.
-- 3. subscription_payments gains the 'manual_grant' payment method.

BEGIN;

-- Trusted role + verified TOTP (aal2). Identical to schema.sql/secure_jobs.sql;
-- re-declared here so this file can be re-run on its own.
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

-- Allow the manual_grant payment method (auditable admin-granted access).
DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.subscription_payments'::regclass AND contype = 'c'
  LOOP
    IF constraint_row.definition LIKE '%payment_method%'
       OR constraint_row.definition LIKE '%upi_reference%' THEN
      EXECUTE format('ALTER TABLE public.subscription_payments DROP CONSTRAINT %I', constraint_row.conname);
    END IF;
  END LOOP;
END
$$;

ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_payment_method_check
    CHECK (payment_method IN ('razorpay', 'upi_manual', 'manual_grant')),
  ADD CONSTRAINT subscription_payments_method_reference_check CHECK (
    (payment_method = 'razorpay' AND razorpay_order_id IS NOT NULL AND upi_reference IS NULL)
    OR (payment_method = 'upi_manual' AND upi_reference IS NOT NULL AND razorpay_order_id IS NULL)
    OR (payment_method = 'manual_grant' AND upi_reference IS NULL AND razorpay_order_id IS NULL)
  );

-- Admin-only: grant special access to a user. Extends the later of
-- (current expiry, now) by p_days and writes a paid manual_grant audit row.
CREATE OR REPLACE FUNCTION public.grant_manual_access(p_user_id uuid, p_days integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_expiry timestamptz;
  new_expiry timestamptz;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only administrators can grant access.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'A user and 1-3650 access days are required.' USING ERRCODE = '22023';
  END IF;

  SELECT subscribed_until INTO current_expiry
  FROM public.user_accounts
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User account not found.' USING ERRCODE = '22023';
  END IF;

  new_expiry := greatest(coalesce(current_expiry, now()), now()) + make_interval(days => p_days);

  UPDATE public.user_accounts
  SET subscribed_until = new_expiry
  WHERE user_id = p_user_id;

  INSERT INTO public.subscription_payments (
    user_id,
    plan_id,
    plan_title,
    plan_days,
    amount_paise,
    currency,
    payment_method,
    payment_status,
    paid_at,
    expires_at,
    reviewed_by,
    reviewed_at
  ) VALUES (
    p_user_id,
    'manual',
    'Manual access grant',
    p_days,
    1,
    'INR',
    'manual_grant',
    'paid',
    now(),
    new_expiry,
    (SELECT auth.uid()),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'expires_at', new_expiry);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_manual_access(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_manual_access(uuid, integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
