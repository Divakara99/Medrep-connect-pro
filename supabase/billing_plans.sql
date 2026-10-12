-- Server-side billing catalog: the authoritative plan prices and durations.
-- Run AFTER schema.sql and payments.sql in the SAME Supabase project as the app.
--
-- Rules enforced here:
--   * Every plan is stored on the server. The browser never supplies a price.
--   * Any signed-in user can READ the catalog (prices are advertised publicly).
--   * Only an MFA-verified administrator (trusted role + aal2 TOTP) can change
--     a price, duration, title, tagline, popular flag or active flag.
--   * Razorpay orders are priced from this table, and subscription_payments
--     keeps its own amount_paise/plan_days snapshot per order, so changing a
--     price later never rewrites history and never affects an existing
--     subscription's expiry.
--
-- Seeding uses ON CONFLICT DO NOTHING: re-running this file keeps whatever an
-- administrator has already saved.

BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_plans (
  id text PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  days integer NOT NULL CHECK (days BETWEEN 1 AND 3650),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  tagline text NOT NULL DEFAULT '',
  popular boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'billing_plans'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.billing_plans', policy_row.policyname);
  END LOOP;
END
$$;
-- Users see purchasable plans; an MFA-verified admin also sees retired ones.
CREATE POLICY billing_plans_read ON public.billing_plans
  FOR SELECT TO authenticated
  USING (active OR public.is_app_admin());
REVOKE ALL ON public.billing_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.billing_plans TO authenticated;
GRANT ALL ON public.billing_plans TO service_role;

-- Admin-only writer. SECURITY DEFINER is safe here because the guard is
-- is_app_admin() (trusted role claim + verified aal2 TOTP) evaluated against
-- the CALLER's token, and every input is re-validated.
CREATE OR REPLACE FUNCTION public.save_billing_plan(
  p_id text,
  p_title text,
  p_days integer,
  p_amount_paise bigint,
  p_tagline text DEFAULT '',
  p_popular boolean DEFAULT false,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  plan_id text := btrim(coalesce(p_id, ''));
  saved public.billing_plans%ROWTYPE;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only an MFA-verified administrator can change plan pricing.'
      USING ERRCODE = '42501';
  END IF;
  IF plan_id = '' OR length(plan_id) > 32 OR plan_id ~ '[^a-z0-9_-]' THEN
    RAISE EXCEPTION 'A valid plan id is required.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_title), '') = '' OR length(btrim(p_title)) > 80 THEN
    RAISE EXCEPTION 'A plan title of 1-80 characters is required.' USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'Plan validity must be between 1 and 3650 days.' USING ERRCODE = '22023';
  END IF;
  IF p_amount_paise IS NULL OR p_amount_paise < 100 OR p_amount_paise > 100000000 THEN
    RAISE EXCEPTION 'Plan price must be between ₹1 and ₹10,00,000.' USING ERRCODE = '22023';
  END IF;

  -- Checkout must never end up with zero purchasable plans.
  IF NOT coalesce(p_active, true)
     AND NOT EXISTS (
       SELECT 1 FROM public.billing_plans
       WHERE active AND id <> plan_id
     ) THEN
    RAISE EXCEPTION 'At least one plan must stay available for checkout.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.billing_plans (
    id, title, days, amount_paise, tagline, popular, active, updated_at, updated_by
  ) VALUES (
    plan_id, btrim(p_title), p_days, p_amount_paise,
    left(coalesce(p_tagline, ''), 160), coalesce(p_popular, false),
    coalesce(p_active, true), now(), auth.uid()
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    days = EXCLUDED.days,
    amount_paise = EXCLUDED.amount_paise,
    tagline = EXCLUDED.tagline,
    popular = EXCLUDED.popular,
    active = EXCLUDED.active,
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING * INTO saved;

  RETURN jsonb_build_object(
    'id', saved.id,
    'title', saved.title,
    'days', saved.days,
    'amountPaise', saved.amount_paise,
    'tagline', saved.tagline,
    'popular', saved.popular,
    'active', saved.active,
    'updatedAt', saved.updated_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.save_billing_plan(text, text, integer, bigint, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_billing_plan(text, text, integer, bigint, text, boolean, boolean)
  TO authenticated;

-- Seed the catalog with the plans already advertised by the app. ON CONFLICT
-- DO NOTHING preserves administrator edits and any plan already retired.
INSERT INTO public.billing_plans (id, title, days, amount_paise, tagline, popular) VALUES
  ('p5',   '5 Days Trial',       5,    4900,   'Quick access — test the network',        false),
  ('p10',  '10 Days Basic',      10,   9900,   'Short hunt for a field role',            false),
  ('p15',  '15 Days Pro',        15,  14900,   'Most chosen for MR switchers',           true),
  ('p30',  '30 Days Standard',   30,  24900,   'Full month of unlocked jobs',            false),
  ('p90',  '3 Months Premium',   90,  59900,   'Serious job seekers',                    false),
  ('p180', '6 Months Elite',    180,  99900,   'Long-haul career move',                  false),
  ('p365', '1 Year Ultimate',   365, 179900,   'Best value — year-long access',          false)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
