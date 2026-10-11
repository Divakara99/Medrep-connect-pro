-- Secure subscription billing for Razorpay Checkout and manual UPI review.
-- Run supabase/schema.sql first, then run this file in the Supabase SQL Editor.
-- Browser clients can only read their own payment rows and account expiry;
-- only server-side Edge Functions (service_role) can create or alter payments.

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id text NOT NULL,
  plan_title text NOT NULL,
  plan_days integer NOT NULL CHECK (plan_days BETWEEN 1 AND 3650),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  payment_method text NOT NULL CHECK (payment_method IN ('razorpay', 'upi_manual')),
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'manual_review', 'paid', 'failed', 'rejected')),
  razorpay_order_id text UNIQUE,
  razorpay_payment_id text UNIQUE,
  upi_reference text UNIQUE,
  utr text,
  gateway_method text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  expires_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  failure_reason text,
  CONSTRAINT subscription_payments_method_reference_check CHECK (
    (payment_method = 'razorpay' AND razorpay_order_id IS NOT NULL AND upi_reference IS NULL)
    OR (payment_method = 'upi_manual' AND upi_reference IS NOT NULL AND razorpay_order_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS subscription_payments_user_created_idx
  ON public.subscription_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_payments_status_created_idx
  ON public.subscription_payments (payment_status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_utr_unique
  ON public.subscription_payments (lower(utr))
  WHERE utr IS NOT NULL;

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_user_read_own_subscription_payments
  ON public.subscription_payments;
CREATE POLICY authenticated_user_read_own_subscription_payments
  ON public.subscription_payments FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS authenticated_admin_read_subscription_payments
  ON public.subscription_payments;
CREATE POLICY authenticated_admin_read_subscription_payments
  ON public.subscription_payments FOR SELECT TO authenticated
  USING (public.is_app_admin());
REVOKE ALL ON public.subscription_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.subscription_payments TO authenticated;
GRANT ALL ON public.subscription_payments TO service_role;

-- Users may read only their own expiry from the existing Auth-backed account
-- projection. The admin SELECT policy from schema.sql remains in force.
DROP POLICY IF EXISTS authenticated_user_read_own_account
  ON public.user_accounts;
CREATE POLICY authenticated_user_read_own_account
  ON public.user_accounts FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
GRANT SELECT ON public.user_accounts TO authenticated;

-- Called only after the Edge Function has verified the Razorpay checkout
-- signature and independently confirmed a captured payment against Razorpay's
-- API. The locked row and unique payment ID make confirmation idempotent.
CREATE OR REPLACE FUNCTION public.confirm_razorpay_subscription_payment(
  p_gateway_order_id text,
  p_gateway_payment_id text,
  p_paid_amount_paise bigint,
  p_gateway_method text,
  p_utr text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  payment_row public.subscription_payments%ROWTYPE;
  current_expiry timestamptz;
  new_expiry timestamptz;
BEGIN
  SELECT * INTO payment_row
  FROM public.subscription_payments
  WHERE razorpay_order_id = p_gateway_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment order was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF payment_row.payment_method <> 'razorpay' THEN
    RAISE EXCEPTION 'Payment method does not match the order.' USING ERRCODE = '22023';
  END IF;
  IF payment_row.amount_paise <> p_paid_amount_paise OR payment_row.currency <> 'INR' THEN
    RAISE EXCEPTION 'Captured amount does not match the selected plan.' USING ERRCODE = '22023';
  END IF;

  IF payment_row.payment_status = 'paid' THEN
    IF payment_row.razorpay_payment_id <> p_gateway_payment_id THEN
      RAISE EXCEPTION 'This order was already confirmed with a different payment.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'paymentId', payment_row.id,
      'userId', payment_row.user_id,
      'planId', payment_row.plan_id,
      'planDays', payment_row.plan_days,
      'expiresAt', payment_row.expires_at,
      'alreadyConfirmed', true
    );
  END IF;

  IF payment_row.payment_status <> 'pending' OR p_gateway_payment_id IS NULL OR btrim(p_gateway_payment_id) = '' THEN
    RAISE EXCEPTION 'Payment is not eligible for confirmation.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscription_payments
    WHERE razorpay_payment_id = p_gateway_payment_id AND id <> payment_row.id
  ) THEN
    RAISE EXCEPTION 'This Razorpay payment is already linked to another order.' USING ERRCODE = '23505';
  END IF;

  SELECT subscribed_until INTO current_expiry
  FROM public.user_accounts
  WHERE user_id = payment_row.user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The subscriber account was not found.' USING ERRCODE = 'P0002';
  END IF;

  new_expiry := greatest(now(), coalesce(current_expiry, now()))
    + make_interval(days => payment_row.plan_days);

  UPDATE public.subscription_payments
  SET payment_status = 'paid',
      razorpay_payment_id = p_gateway_payment_id,
      gateway_method = nullif(p_gateway_method, ''),
      utr = nullif(btrim(p_utr), ''),
      paid_at = now(),
      expires_at = new_expiry,
      failure_reason = NULL
  WHERE id = payment_row.id;

  UPDATE public.user_accounts
  SET subscribed_until = new_expiry
  WHERE user_id = payment_row.user_id;

  RETURN jsonb_build_object(
    'paymentId', payment_row.id,
    'userId', payment_row.user_id,
    'planId', payment_row.plan_id,
    'planDays', payment_row.plan_days,
    'expiresAt', new_expiry,
    'alreadyConfirmed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_razorpay_subscription_payment(text, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_razorpay_subscription_payment(text, text, bigint, text, text)
  TO service_role;

-- Manual UPI is deliberately NOT activated from a user-entered UTR. The
-- verified admin checks the bank statement first, then this function changes
-- status and applies the server-stored plan duration atomically.
CREATE OR REPLACE FUNCTION public.review_manual_upi_subscription_payment(
  p_payment_id uuid,
  p_reviewer_id uuid,
  p_approve boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  payment_row public.subscription_payments%ROWTYPE;
  current_expiry timestamptz;
  new_expiry timestamptz;
BEGIN
  SELECT * INTO payment_row
  FROM public.subscription_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manual UPI payment was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF payment_row.payment_method <> 'upi_manual' THEN
    RAISE EXCEPTION 'Payment is not a manual UPI request.' USING ERRCODE = '22023';
  END IF;

  IF payment_row.payment_status = 'paid' AND p_approve THEN
    RETURN jsonb_build_object(
      'paymentId', payment_row.id,
      'userId', payment_row.user_id,
      'planId', payment_row.plan_id,
      'planDays', payment_row.plan_days,
      'expiresAt', payment_row.expires_at,
      'alreadyReviewed', true
    );
  END IF;
  IF payment_row.payment_status <> 'manual_review' THEN
    RAISE EXCEPTION 'Payment is not waiting for manual review.' USING ERRCODE = '22023';
  END IF;

  IF NOT p_approve THEN
    UPDATE public.subscription_payments
    SET payment_status = 'rejected', reviewed_by = p_reviewer_id, reviewed_at = now()
    WHERE id = payment_row.id;
    RETURN jsonb_build_object('paymentId', payment_row.id, 'paymentStatus', 'rejected');
  END IF;

  IF payment_row.utr IS NULL OR btrim(payment_row.utr) = '' THEN
    RAISE EXCEPTION 'A UTR is required before review.' USING ERRCODE = '22023';
  END IF;

  SELECT subscribed_until INTO current_expiry
  FROM public.user_accounts
  WHERE user_id = payment_row.user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The subscriber account was not found.' USING ERRCODE = 'P0002';
  END IF;

  new_expiry := greatest(now(), coalesce(current_expiry, now()))
    + make_interval(days => payment_row.plan_days);

  UPDATE public.subscription_payments
  SET payment_status = 'paid', paid_at = now(), expires_at = new_expiry,
      reviewed_by = p_reviewer_id, reviewed_at = now()
  WHERE id = payment_row.id;
  UPDATE public.user_accounts
  SET subscribed_until = new_expiry
  WHERE user_id = payment_row.user_id;

  RETURN jsonb_build_object(
    'paymentId', payment_row.id,
    'userId', payment_row.user_id,
    'planId', payment_row.plan_id,
    'planDays', payment_row.plan_days,
    'expiresAt', new_expiry,
    'alreadyReviewed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.review_manual_upi_subscription_payment(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_manual_upi_subscription_payment(uuid, uuid, boolean)
  TO service_role;
