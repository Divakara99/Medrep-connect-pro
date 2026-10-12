import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

/**
 * Server-side billing catalog checks:
 *   - prices live in public.billing_plans, readable by any signed-in user
 *   - only an MFA-verified admin (trusted role + aal2) can change a price
 *   - checkout can never be left with zero purchasable plans
 *   - an existing order keeps its own amount/days snapshot, so a later price
 *     change never rewrites history or an active subscription
 */
const db = new PGlite()
const freeId = '11111111-1111-4111-8111-111111111111'
const paidId = '22222222-2222-4222-8222-222222222222'
const adminId = '33333333-3333-4333-8333-333333333333'

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    INSERT INTO auth.users (id, email) VALUES
      ('${freeId}', 'free@example.org'),
      ('${paidId}', 'paid@example.org'),
      ('${adminId}', 'admin@example.org');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT jsonb_build_object(
        'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
        'email', coalesce((SELECT email FROM auth.users u WHERE u.id::text = current_setting('request.jwt.claim.sub', true)), ''),
        'app_metadata', jsonb_build_object('role', CASE WHEN current_setting('test.admin', true) = 'true' THEN 'admin' ELSE 'user' END),
        'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1')
      )
    $$;
    CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
         AND coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
    $$;
    CREATE TABLE public.user_accounts (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id),
      subscribed_until timestamptz
    );
    INSERT INTO public.user_accounts VALUES ('${paidId}', NULL), ('${freeId}', NULL);
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;
  `)

  for (const file of ['payments.sql', 'billing_plans.sql']) {
    await db.exec(await readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8'))
  }
  await db.exec(await readFile(new URL('../supabase/billing_plans.sql', import.meta.url), 'utf8'))

  // The advertised catalog is seeded exactly once, with server-owned prices.
  const { rows: seeded } = await db.query(
    'SELECT id, days, amount_paise FROM public.billing_plans ORDER BY id',
  )
  assert.deepEqual(
    seeded.map((row) => [row.id, row.days, Number(row.amount_paise)]),
    [
      ['p10', 10, 9900],
      ['p15', 15, 14900],
      ['p180', 180, 99900],
      ['p30', 30, 24900],
      ['p365', 365, 179900],
      ['p5', 5, 4900],
      ['p90', 90, 59900],
    ],
    'every existing plan must stay in the server catalog',
  )

  // A signed-in job seeker can read prices but cannot write them.
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${freeId}'`)
  const { rows: [visible] } = await db.query('SELECT count(*)::int AS count FROM public.billing_plans')
  assert.equal(visible.count, 7, 'all plans must stay selectable for users')
  await assert.rejects(
    db.query('UPDATE public.billing_plans SET amount_paise = 100 WHERE id = $1', ['p365']),
    /permission denied/,
    'a job seeker must not be able to rewrite a price',
  )
  await assert.rejects(
    db.query("SELECT public.save_billing_plan('p365', 'Hacked', 3650, 100, '', false, true)"),
    /MFA-verified administrator/,
    'the write RPC must refuse a non-admin caller',
  )

  // A password-only (aal1) admin is not enough.
  await db.exec(`SET request.jwt.claim.sub = '${adminId}'; SET test.admin = 'true'; SET test.aal = 'aal1'`)
  await assert.rejects(
    db.query("SELECT public.save_billing_plan('p15', '15 Days Pro', 15, 19900, '', true, true)"),
    /MFA-verified administrator/,
    'an admin without verified TOTP must not change prices',
  )

  // An MFA-verified admin can change the price; the new value is what checkout reads.
  await db.exec("SET test.aal = 'aal2'")
  const { rows: [saved] } = await db.query(
    "SELECT public.save_billing_plan('p15', '15 Days Pro', 15, 19900, 'Most chosen for MR switchers', true, true) AS plan",
  )
  assert.equal(Number(saved.plan.amountPaise), 19900)
  const { rows: [reread] } = await db.query('SELECT amount_paise FROM public.billing_plans WHERE id = $1', ['p15'])
  assert.equal(Number(reread.amount_paise), 19900, 'the edited price must be stored server-side')

  // Retiring plans is allowed, but checkout must never be left empty.
  await db.query("SELECT public.save_billing_plan('p15', '15 Days Pro', 15, 19900, '', true, false)")
  await assert.rejects(
    Promise.all([
      db.query("SELECT public.save_billing_plan('p5', '5 Days Trial', 5, 4900, '', false, false)"),
      db.query("SELECT public.save_billing_plan('p10', '10 Days Basic', 10, 9900, '', false, false)"),
      db.query("SELECT public.save_billing_plan('p30', '30 Days Standard', 30, 24900, '', false, false)"),
      db.query("SELECT public.save_billing_plan('p90', '3 Months Premium', 90, 59900, '', false, false)"),
      db.query("SELECT public.save_billing_plan('p180', '6 Months Elite', 180, 99900, '', false, false)"),
      db.query("SELECT public.save_billing_plan('p365', '1 Year Ultimate', 365, 179900, '', false, false)"),
    ]).then(async () => {
      await db.query("SELECT public.save_billing_plan('p15', '15 Days Pro', 15, 19900, '', true, false)")
    }),
    /At least one plan/,
    'the last purchasable plan must stay available',
  )
  await db.query("SELECT public.save_billing_plan('p15', '15 Days Pro', 15, 19900, '', true, true)")

  // An order placed before the price change keeps its own snapshot.
  await db.exec('RESET ROLE')
  await db.query(`
    INSERT INTO public.subscription_payments (
      id, user_id, plan_id, plan_title, plan_days, amount_paise, currency,
      payment_method, payment_status, razorpay_order_id
    ) VALUES (
      '44444444-4444-4444-8444-444444444444', '${paidId}', 'p15', '15 Days Pro', 15, 14900, 'INR',
      'razorpay', 'pending', 'order_snapshot'
    )`)

  const { rows: [confirmed] } = await db.query(`
    SELECT public.confirm_razorpay_subscription_payment(
      'order_snapshot', 'pay_snapshot', 14900, 'upi', NULL
    ) AS result`)
  assert.equal(confirmed.result.planDays, 15, 'activation must use the order snapshot, not the new catalog')
  const { rows: [payment] } = await db.query(
    "SELECT amount_paise, plan_days FROM public.subscription_payments WHERE razorpay_order_id = 'order_snapshot'",
  )
  assert.equal(Number(payment.amount_paise), 14900, 'the captured amount snapshot must not change')
  assert.equal(payment.plan_days, 15)
  const { rows: [account] } = await db.query(
    `SELECT extract(epoch FROM subscribed_until - now()) / 86400 AS days FROM public.user_accounts WHERE user_id = '${paidId}'`,
  )
  assert.ok(Math.abs(Number(account.days) - 15) < 0.01, 'existing subscriptions keep the purchased duration')

  await db.exec('SET ROLE anon')
  const { rows: [grants] } = await db.query(`SELECT
    has_function_privilege('anon', 'public.save_billing_plan(text,text,integer,bigint,text,boolean,boolean)', 'EXECUTE') AS anon_save,
    has_table_privilege('anon', 'public.billing_plans', 'SELECT') AS anon_read,
    has_table_privilege('authenticated', 'public.billing_plans', 'UPDATE') AS user_write`)
  assert.equal(grants.anon_save, false)
  assert.equal(grants.anon_read, false, 'pricing is only exposed to signed-in users')
  assert.equal(grants.user_write, false, 'only the guarded RPC may write the catalog')

  console.log('billing plans SQL: catalog, admin-only pricing, checkout floor and order snapshots passed')
} finally {
  await db.close()
}
