import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const userId = '33333333-3333-4333-8333-333333333333'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${userId}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.user_accounts (user_id uuid PRIMARY KEY REFERENCES auth.users(id), subscribed_until timestamptz);
    INSERT INTO public.user_accounts VALUES ('${userId}', NULL);
    CREATE TABLE public.billing_plans (
      id text PRIMARY KEY, title text NOT NULL, days integer NOT NULL, amount_paise bigint NOT NULL,
      tagline text NOT NULL DEFAULT '', popular boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid
    );
    INSERT INTO public.billing_plans (id, title, days, amount_paise) VALUES ('p5', '5 Days Trial', 5, 4900);
    CREATE TABLE public.subscription_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      plan_id text NOT NULL, plan_title text NOT NULL,
      plan_days integer NOT NULL CHECK (plan_days BETWEEN 1 AND 3650),
      amount_paise bigint NOT NULL CHECK (amount_paise > 0),
      currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
      payment_method text NOT NULL CHECK (payment_method IN ('razorpay', 'upi_manual')),
      payment_status text NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'manual_review', 'paid', 'failed', 'rejected')),
      razorpay_order_id text UNIQUE, razorpay_payment_id text UNIQUE, upi_reference text UNIQUE,
      utr text, gateway_method text,
      created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz, expires_at timestamptz,
      reviewed_by uuid, reviewed_at timestamptz, failure_reason text,
      CONSTRAINT subscription_payments_method_reference_check CHECK (
        (payment_method = 'razorpay' AND razorpay_order_id IS NOT NULL AND upi_reference IS NULL)
        OR (payment_method = 'upi_manual' AND upi_reference IS NOT NULL AND razorpay_order_id IS NULL)
      )
    );
  `)
  const billing = await readFile(new URL('../supabase/google_play_billing.sql', import.meta.url), 'utf8')
  await db.exec(billing)
  await db.exec(billing) // idempotent re-run

  const { rows: [plan] } = await db.query(`SELECT play_product_id FROM public.billing_plans WHERE id = 'p5'`)
  assert.equal(plan.play_product_id, 'medrep_pass_5d', 'plan seeded with its Play product')

  const args = `('${userId}', 'p5', 'medrep_pass_5d', 'GPA.1', 'hash-token-1')`
  const { rows: [first] } = await db.query(`SELECT public.confirm_google_play_subscription_payment${args} AS result`)
  assert.equal(first.result.alreadyConfirmed, false)
  const expiry1 = first.result.expiresAt
  assert.ok(new Date(expiry1).getTime() > Date.now() + 4 * 86400_000, 'expiry extended by the plan days')

  // Idempotent replay: same token never extends twice.
  const { rows: [replay] } = await db.query(`SELECT public.confirm_google_play_subscription_payment${args} AS result`)
  assert.equal(replay.result.alreadyConfirmed, true)
  assert.equal(replay.result.expiresAt, expiry1, 'replay returns the original expiry')

  // Wrong product for the plan is refused (price/duration come from the catalog).
  await assert.rejects(
    db.query(`SELECT public.confirm_google_play_subscription_payment('${userId}', 'p5', 'medrep_pass_365d', 'GPA.2', 'hash-token-2')`),
    /not available on Google Play/,
  )

  // Finalise flags are recorded.
  await db.query(`SELECT public.mark_google_play_purchase_finalised('hash-token-1', true, true)`)

  // Refund of the latest grant claws the days back.
  const { rows: [voided] } = await db.query(`SELECT public.handle_google_play_voided_purchase('hash-token-1', 'refunded') AS result`)
  assert.equal(voided.result.clawedBack, true)
  const { rows: [account] } = await db.query(`SELECT subscribed_until FROM public.user_accounts WHERE user_id = '${userId}'`)
  assert.ok(new Date(account.subscribed_until).getTime() < Date.now() + 86400_000, 'refunded days are removed')
  const { rows: [again] } = await db.query(`SELECT public.handle_google_play_voided_purchase('hash-token-1', 'refunded') AS result`)
  assert.equal(again.result.alreadyHandled, true, 'double void is a no-op')

  console.log('play billing: catalog-priced activation, token idempotency, finalise flags, refund claw-back — passed')
} finally {
  await db.close()
}
