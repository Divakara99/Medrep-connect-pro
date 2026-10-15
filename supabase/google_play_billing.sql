-- Google Play Billing for the Android app (one-time "N-day pass" products).
-- Run AFTER schema.sql, payments.sql and billing_plans.sql in the SAME
-- Supabase project. Safe to re-run. The website (Razorpay/UPI) is untouched:
-- every change here is additive.
--
-- Rules enforced here (mirroring the Razorpay flow):
--   * Each plan maps to one Play product via billing_plans.play_product_id.
--   * A purchase activates only from confirm_google_play_subscription_payment,
--     called by the verify-google-play-purchase Edge Function (service role)
--     AFTER Google Play Developer API confirms the token. Price/duration
--     come from the server catalog row, never from the device.
--   * The SHA-256 hash of the purchase token is UNIQUE: the same token can
--     never activate twice (idempotent replays return alreadyConfirmed).
--   * Refunds/voids (handle_google_play_voided_purchase) mark the payment
--     refunded and claw the granted days back ONLY when the account's current
--     expiry is exactly the expiry this purchase granted (i.e. nothing was
--     bought after it) — otherwise the row is flagged needs_review instead
--     of silently eating a later, legitimate renewal.

BEGIN;

-- 1) Plan -> Play product mapping ------------------------------------------------
ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS play_product_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'billing_plans_play_product_unique'
      AND conrelid = 'public.billing_plans'::regclass
  ) THEN
    ALTER TABLE public.billing_plans
      ADD CONSTRAINT billing_plans_play_product_unique UNIQUE (play_product_id);
  END IF;
END
$$;

-- Seed the mapping (product ids to create in Play Console — see ANDROID.md).
-- Existing administrator edits to other columns are preserved.
UPDATE public.billing_plans SET play_product_id = 'medrep_pass_5d'   WHERE id = 'p5'   AND play_product_id IS NULL;
UPDATE public.billing_plans SET play_product_id = 'medrep_pass_10d'  WHERE id = 'p10'  AND play_product_id IS NULL;
UPDATE public.billing_plans SET play_product_id = 'medrep_pass_15d'  WHERE id = 'p15'  AND play_product_id IS NULL;
UPDATE public.billing_plans SET play_product_id = 'medrep_pass_30d'  WHERE id = 'p30'  AND play_product_id IS NULL;
UPDATE public.billing_plans SET play_product_id = 'medrep_pass_90d'  WHERE id = 'p90'  AND play_product_id IS NULL;
UPDATE public.billing_plans SET play_product_id = 'medrep_pass_180d' WHERE id = 'p180' AND play_product_id IS NULL;
UPDATE public.billing_plans SET play_product_id = 'medrep_pass_365d' WHERE id = 'p365' AND play_product_id IS NULL;

-- 2) subscription_payments learns the google_play method ------------------------
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS play_order_id text,
  ADD COLUMN IF NOT EXISTS play_purchase_token_hash text,
  ADD COLUMN IF NOT EXISTS play_product_id text,
  ADD COLUMN IF NOT EXISTS play_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS play_consumed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_play_token_hash_unique
  ON public.subscription_payments (play_purchase_token_hash)
  WHERE play_purchase_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_play_order_unique
  ON public.subscription_payments (play_order_id)
  WHERE play_order_id IS NOT NULL;

-- Replace the Razorpay-era checks with ones that also admit google_play.
ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_payment_method_check;
ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_payment_method_check
  CHECK (payment_method IN ('razorpay', 'upi_manual', 'google_play', 'manual_grant'));

ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_method_reference_check;
ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_method_reference_check CHECK (
    (payment_method = 'razorpay' AND razorpay_order_id IS NOT NULL AND upi_reference IS NULL)
    OR (payment_method = 'upi_manual' AND upi_reference IS NOT NULL AND razorpay_order_id IS NULL)
    OR (payment_method = 'google_play' AND play_purchase_token_hash IS NOT NULL AND razorpay_order_id IS NULL AND upi_reference IS NULL)
    OR (payment_method = 'manual_grant' AND razorpay_order_id IS NULL AND upi_reference IS NULL)
  );

ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_payment_status_check;
ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_payment_status_check
  CHECK (payment_status IN ('pending', 'manual_review', 'paid', 'failed', 'rejected', 'refunded', 'voided'));

-- 3) Activation — the Google Play twin of confirm_razorpay_subscription_payment -
CREATE OR REPLACE FUNCTION public.confirm_google_play_subscription_payment(
  p_user_id uuid,
  p_plan_id text,
  p_play_product_id text,
  p_play_order_id text,
  p_purchase_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  plan_row public.billing_plans%ROWTYPE;
  payment_row public.subscription_payments%ROWTYPE;
  current_expiry timestamptz;
  new_expiry timestamptz;
BEGIN
  IF p_purchase_token_hash IS NULL OR btrim(p_purchase_token_hash) = '' THEN
    RAISE EXCEPTION 'A purchase token is required.' USING ERRCODE = '22023';
  END IF;

  -- Idempotency first: a replayed token returns its original result and
  -- never extends twice.
  SELECT * INTO payment_row
  FROM public.subscription_payments
  WHERE play_purchase_token_hash = p_purchase_token_hash
  FOR UPDATE;
  IF FOUND THEN
    IF payment_row.user_id <> p_user_id OR payment_row.plan_id <> p_plan_id THEN
      RAISE EXCEPTION 'This purchase is already linked to a different account or plan.' USING ERRCODE = '23505';
    END IF;
    IF payment_row.payment_status = 'paid' THEN
      RETURN jsonb_build_object(
        'paymentId', payment_row.id, 'userId', payment_row.user_id,
        'planId', payment_row.plan_id, 'planDays', payment_row.plan_days,
        'expiresAt', payment_row.expires_at, 'alreadyConfirmed', true
      );
    END IF;
    RAISE EXCEPTION 'This purchase is not eligible for confirmation.' USING ERRCODE = '22023';
  END IF;

  -- Price and duration come from the server catalog, keyed by the Play
  -- product the Developer API just verified.
  SELECT * INTO plan_row
  FROM public.billing_plans
  WHERE id = p_plan_id AND active AND play_product_id = p_play_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected plan is not available on Google Play.' USING ERRCODE = '22023';
  END IF;

  SELECT subscribed_until INTO current_expiry
  FROM public.user_accounts
  WHERE user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The subscriber account was not found.' USING ERRCODE = 'P0002';
  END IF;

  new_expiry := greatest(now(), coalesce(current_expiry, now()))
    + make_interval(days => plan_row.days);

  INSERT INTO public.subscription_payments (
    user_id, plan_id, plan_title, plan_days, amount_paise, currency,
    payment_method, payment_status, play_order_id, play_purchase_token_hash,
    play_product_id, paid_at, expires_at
  ) VALUES (
    p_user_id, plan_row.id, plan_row.title, plan_row.days, plan_row.amount_paise, 'INR',
    'google_play', 'paid', nullif(btrim(coalesce(p_play_order_id, '')), ''),
    p_purchase_token_hash, p_play_product_id, now(), new_expiry
  )
  RETURNING * INTO payment_row;

  UPDATE public.user_accounts
  SET subscribed_until = new_expiry
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'paymentId', payment_row.id, 'userId', payment_row.user_id,
    'planId', payment_row.plan_id, 'planDays', payment_row.plan_days,
    'expiresAt', payment_row.expires_at, 'alreadyConfirmed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_google_play_subscription_payment(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_google_play_subscription_payment(uuid, text, text, text, text)
  TO service_role;

-- Mark a just-confirmed purchase acknowledged / consumed (called by the same
-- Edge Function after the Play API acknowledge/consume calls succeed).
CREATE OR REPLACE FUNCTION public.mark_google_play_purchase_finalised(
  p_purchase_token_hash text,
  p_acknowledged boolean,
  p_consumed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  payment_row public.subscription_payments%ROWTYPE;
BEGIN
  UPDATE public.subscription_payments
  SET play_acknowledged = play_acknowledged OR coalesce(p_acknowledged, false),
      play_consumed = play_consumed OR coalesce(p_consumed, false)
  WHERE play_purchase_token_hash = p_purchase_token_hash
  RETURNING * INTO payment_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase was not found.' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'paymentId', payment_row.id,
    'acknowledged', payment_row.play_acknowledged,
    'consumed', payment_row.play_consumed
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mark_google_play_purchase_finalised(text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_google_play_purchase_finalised(text, boolean, boolean)
  TO service_role;

-- 4) Refunds / voided purchases --------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_google_play_voided_purchase(
  p_purchase_token_hash text,
  p_reason text DEFAULT 'voided'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  payment_row public.subscription_payments%ROWTYPE;
  current_expiry timestamptz;
  clawed boolean := false;
BEGIN
  SELECT * INTO payment_row
  FROM public.subscription_payments
  WHERE play_purchase_token_hash = p_purchase_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  IF payment_row.payment_status IN ('refunded', 'voided') THEN
    RETURN jsonb_build_object('found', true, 'paymentId', payment_row.id, 'alreadyHandled', true);
  END IF;
  IF payment_row.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid purchase can be voided.' USING ERRCODE = '22023';
  END IF;

  SELECT subscribed_until INTO current_expiry
  FROM public.user_accounts
  WHERE user_id = payment_row.user_id
  FOR UPDATE;

  -- Claw the days back only when this purchase is still the latest grant
  -- (current expiry == the expiry it set). If the user renewed afterwards,
  -- a human must unpick it: flag, don't guess.
  IF current_expiry IS NOT NULL AND payment_row.expires_at IS NOT NULL
     AND current_expiry = payment_row.expires_at THEN
    UPDATE public.user_accounts
    SET subscribed_until = payment_row.expires_at - make_interval(days => payment_row.plan_days)
    WHERE user_id = payment_row.user_id;
    clawed := true;
  END IF;

  UPDATE public.subscription_payments
  SET payment_status = CASE WHEN p_reason = 'refunded' THEN 'refunded' ELSE 'voided' END,
      refunded_at = now(),
      needs_review = NOT clawed,
      failure_reason = left(coalesce(nullif(btrim(p_reason), ''), 'voided'), 200)
  WHERE id = payment_row.id;

  RETURN jsonb_build_object(
    'found', true, 'paymentId', payment_row.id, 'userId', payment_row.user_id,
    'clawedBack', clawed, 'needsReview', NOT clawed
  );
END;
$$;
REVOKE ALL ON FUNCTION public.handle_google_play_voided_purchase(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_google_play_voided_purchase(text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
