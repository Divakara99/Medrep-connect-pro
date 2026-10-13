-- Support and refund requests, kept on the server so that a user can follow
-- them from any device and an administrator can review every one.
--
-- * Users never write this table directly. They call
--   public.create_support_request(), which takes the identity from the verified
--   token, re-checks refund eligibility against subscription_payments and adds
--   a server-side snapshot of the account and the chosen payment.
-- * A user can read only their own requests (including the admin's reply).
-- * An administrator with the trusted role AND an aal2 session can read every
--   request and update status / reply through admin_update_support_request().
-- * Repeatable: safe to run more than once.
--
-- Run after admin_mfa.sql and billing_plans.sql (it uses is_app_admin() and
-- subscription_payments).

CREATE TABLE IF NOT EXISTS public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('support', 'refund')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 160),
  message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 4000),
  reason_code text CHECK (reason_code IN ('captured_not_active', 'duplicate_charge', 'failed_but_debited')),
  payment_id uuid REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  ai_verdict text CHECK (ai_verdict IN ('eligible', 'needs_review', 'not_eligible')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  admin_reply text CHECK (char_length(admin_reply) <= 4000),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT support_requests_refund_fields CHECK (
    kind = 'support' OR (reason_code IS NOT NULL AND payment_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS support_requests_user_created_idx
  ON public.support_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_requests_status_created_idx
  ON public.support_requests (status, created_at DESC);
-- One refund request per payment, whatever its state.
CREATE UNIQUE INDEX IF NOT EXISTS support_requests_one_refund_per_payment_idx
  ON public.support_requests (payment_id) WHERE kind = 'refund';

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_requests_owner_select ON public.support_requests;
CREATE POLICY support_requests_owner_select ON public.support_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS support_requests_admin_select ON public.support_requests;
CREATE POLICY support_requests_admin_select ON public.support_requests
  FOR SELECT TO authenticated
  USING (public.is_app_admin());

REVOKE ALL ON public.support_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_requests TO authenticated;

-- ---------------------------------------------------------------------------
-- Refund rules (mirrored in src/data/refundCheck.ts; the test suite checks both).
--
--   captured_not_active  payment is pending/failed but the gateway captured it
--                        (a Razorpay payment id exists)          -> needs_review
--   duplicate_charge     two PAID payments for the same plan within 48 hours
--                                                               -> eligible
--   failed_but_debited   payment failed or is pending, bank debit to be checked
--                                                               -> needs_review
--   anything else, a payment that is already activated, or a payment that
--   already has a refund request                                -> not_eligible
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_verdict(p_user uuid, p_payment uuid, p_reason text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  duplicate_exists boolean;
BEGIN
  SELECT id, plan_id, payment_status, razorpay_payment_id, paid_at, created_at
    INTO p
    FROM public.subscription_payments
    WHERE id = p_payment AND user_id = p_user;
  IF NOT FOUND THEN
    RETURN 'not_eligible';
  END IF;

  IF EXISTS (SELECT 1 FROM public.support_requests WHERE payment_id = p_payment AND kind = 'refund') THEN
    RETURN 'not_eligible';
  END IF;

  IF p_reason = 'captured_not_active' THEN
    IF p.payment_status IN ('pending', 'failed') AND p.razorpay_payment_id IS NOT NULL THEN
      RETURN 'needs_review';
    END IF;
    RETURN 'not_eligible';

  ELSIF p_reason = 'duplicate_charge' THEN
    IF p.payment_status <> 'paid' THEN
      RETURN 'not_eligible';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.subscription_payments q
      WHERE q.user_id = p_user
        AND q.id <> p.id
        AND q.payment_status = 'paid'
        AND q.plan_id = p.plan_id
        AND abs(extract(epoch FROM (coalesce(q.paid_at, q.created_at) - coalesce(p.paid_at, p.created_at)))) <= 172800
    ) INTO duplicate_exists;
    IF duplicate_exists THEN
      RETURN 'eligible';
    END IF;
    RETURN 'not_eligible';

  ELSIF p_reason = 'failed_but_debited' THEN
    IF p.payment_status IN ('pending', 'failed') THEN
      RETURN 'needs_review';
    END IF;
    RETURN 'not_eligible';
  END IF;

  RETURN 'not_eligible';
END
$$;

-- ---------------------------------------------------------------------------
-- Users raise requests here. Identity and account details come from the server.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_support_request(
  p_kind text,
  p_subject text,
  p_message text,
  p_reason_code text DEFAULT NULL,
  p_payment_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS public.support_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  owner_email text;
  verdict text := NULL;
  pay record;
  snapshot jsonb := '{}'::jsonb;
  open_count integer;
  row_out public.support_requests;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to contact support.' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('support', 'refund') THEN
    RAISE EXCEPTION 'Unsupported request type.';
  END IF;
  IF char_length(btrim(coalesce(p_subject, ''))) NOT BETWEEN 3 AND 160 THEN
    RAISE EXCEPTION 'The subject must be 3 to 160 characters.';
  END IF;
  IF char_length(btrim(coalesce(p_message, ''))) NOT BETWEEN 10 AND 4000 THEN
    RAISE EXCEPTION 'Please describe the issue in at least 10 characters.';
  END IF;
  IF pg_column_size(coalesce(p_details, '{}'::jsonb)) > 16000 THEN
    RAISE EXCEPTION 'The request details are too large.';
  END IF;

  SELECT count(*) INTO open_count
    FROM public.support_requests
    WHERE user_id = uid AND status <> 'resolved';
  IF open_count >= 5 THEN
    RAISE EXCEPTION 'You already have 5 open requests. Please wait for a reply before raising another.';
  END IF;

  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO pay FROM public.subscription_payments
      WHERE id = p_payment_id AND user_id = uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That payment was not found on your account.';
    END IF;
  END IF;

  IF p_kind = 'refund' THEN
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('captured_not_active', 'duplicate_charge', 'failed_but_debited') THEN
      RAISE EXCEPTION 'Choose a refund reason.';
    END IF;
    IF p_payment_id IS NULL THEN
      RAISE EXCEPTION 'Choose the payment you want refunded.';
    END IF;
    verdict := public.refund_verdict(uid, p_payment_id, p_reason_code);
    IF verdict = 'not_eligible' THEN
      RAISE EXCEPTION 'This payment does not qualify for a refund under our terms. You can raise a support request instead.'
        USING HINT = 'refund_not_eligible';
    END IF;
  END IF;

  SELECT email INTO owner_email FROM auth.users WHERE id = uid;

  snapshot := jsonb_build_object(
    'accountEmail', owner_email,
    'userId', uid,
    'recentPayments', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'planTitle', r.plan_title,
        'amountInr', r.amount_paise / 100.0,
        'status', r.payment_status,
        'gatewayPaymentId', r.razorpay_payment_id,
        'utr', r.utr,
        'createdAt', r.created_at
      ) ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM public.subscription_payments
        WHERE user_id = uid
        ORDER BY created_at DESC
        LIMIT 5
      ) r
    )
  );
  IF p_payment_id IS NOT NULL THEN
    snapshot := snapshot || jsonb_build_object('payment', jsonb_build_object(
      'id', pay.id,
      'planId', pay.plan_id,
      'planTitle', pay.plan_title,
      'planDays', pay.plan_days,
      'amountInr', pay.amount_paise / 100.0,
      'status', pay.payment_status,
      'method', pay.payment_method,
      'gatewayPaymentId', pay.razorpay_payment_id,
      'orderId', pay.razorpay_order_id,
      'utr', pay.utr,
      'createdAt', pay.created_at,
      'paidAt', pay.paid_at
    ));
  END IF;

  INSERT INTO public.support_requests (
    user_id, kind, subject, message, reason_code, payment_id, ai_verdict, details
  ) VALUES (
    uid,
    p_kind,
    btrim(p_subject),
    btrim(p_message),
    CASE WHEN p_kind = 'refund' THEN p_reason_code END,
    p_payment_id,
    verdict,
    coalesce(p_details, '{}'::jsonb) || snapshot
  )
  RETURNING * INTO row_out;

  RETURN row_out;
END
$$;

-- ---------------------------------------------------------------------------
-- Administrators (trusted role + aal2) update status and reply.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_support_request(
  p_id uuid,
  p_status text,
  p_reply text DEFAULT NULL
)
RETURNS public.support_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_out public.support_requests;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Administrator access with a verified authenticator is required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('open', 'in_progress', 'resolved') THEN
    RAISE EXCEPTION 'Unsupported status.';
  END IF;
  IF p_reply IS NOT NULL AND char_length(p_reply) > 4000 THEN
    RAISE EXCEPTION 'The reply is too long.';
  END IF;

  UPDATE public.support_requests SET
    status = p_status,
    admin_reply = CASE
      WHEN nullif(btrim(coalesce(p_reply, '')), '') IS NULL THEN admin_reply
      ELSE btrim(p_reply)
    END,
    reviewed_by = auth.uid(),
    updated_at = now(),
    resolved_at = CASE WHEN p_status = 'resolved' THEN coalesce(resolved_at, now()) ELSE NULL END
  WHERE id = p_id
  RETURNING * INTO row_out;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found.';
  END IF;
  RETURN row_out;
END
$$;

REVOKE ALL ON FUNCTION public.refund_verdict(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_support_request(text, text, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_request(text, text, text, text, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_update_support_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_support_request(uuid, text, text) TO authenticated;
