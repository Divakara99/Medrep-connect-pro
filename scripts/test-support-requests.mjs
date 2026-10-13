import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

/**
 * Support and refund request checks:
 *   - a user can raise a support request; identity and account details come
 *     from the verified token and the server, never from the browser
 *   - a user cannot write the table directly and sees only their own requests
 *   - refund eligibility is decided by the server from the payment ledger
 *   - one refund request per payment; at most five open requests per user
 *   - only an MFA-verified administrator can update status and reply
 */
const db = new PGlite()
const userId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const adminId = '33333333-3333-4333-8333-333333333333'

const paid = {
  pA: 'a0000000-0000-4000-8000-00000000000a', // paid, duplicate partner pB (same plan, same day)
  pB: 'a0000000-0000-4000-8000-00000000000b',
  pC: 'a0000000-0000-4000-8000-00000000000c', // pending, gateway captured it
  pD: 'a0000000-0000-4000-8000-00000000000d', // failed, bank debit to check
  pE: 'a0000000-0000-4000-8000-00000000000e', // paid, no duplicate
  pF: 'a0000000-0000-4000-8000-00000000000f', // belongs to another user
}

async function asUser(id, extra = '') {
  await db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${id}'; SET test.admin = 'false'; SET test.aal = 'aal1'; ${extra}`)
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    INSERT INTO auth.users (id, email) VALUES
      ('${userId}', 'user@example.org'),
      ('${otherId}', 'other@example.org'),
      ('${adminId}', 'admin@example.org');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT jsonb_build_object(
        'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
        'app_metadata', jsonb_build_object('role', CASE WHEN current_setting('test.admin', true) = 'true' THEN 'admin' ELSE 'user' END),
        'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1')
      )
    $$;
    CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
         AND coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
    $$;
    -- Stand-in for public.subscription_payments (same columns used by the migration).
    CREATE TABLE public.subscription_payments (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      plan_id text NOT NULL,
      plan_title text NOT NULL,
      plan_days integer NOT NULL,
      amount_paise bigint NOT NULL,
      payment_method text NOT NULL,
      payment_status text NOT NULL,
      razorpay_order_id text,
      razorpay_payment_id text,
      upi_reference text,
      utr text,
      created_at timestamptz NOT NULL DEFAULT now(),
      paid_at timestamptz
    );
    INSERT INTO public.subscription_payments
      (id, user_id, plan_id, plan_title, plan_days, amount_paise, payment_method, payment_status, razorpay_order_id, razorpay_payment_id, created_at, paid_at)
    VALUES
      ('${paid.pA}', '${userId}', 'p15', '15 Days Pro', 15, 14900, 'razorpay', 'paid', 'order_A', 'pay_A', now() - interval '1 day', now() - interval '1 day'),
      ('${paid.pB}', '${userId}', 'p15', '15 Days Pro', 15, 14900, 'razorpay', 'paid', 'order_B', 'pay_B', now() - interval '1 day', now() - interval '1 day' + interval '1 hour'),
      ('${paid.pC}', '${userId}', 'p5', '5 Days Trial', 5, 4900, 'razorpay', 'pending', 'order_C', 'pay_C', now() - interval '2 days', NULL),
      ('${paid.pD}', '${userId}', 'p10', '10 Days Basic', 10, 9900, 'razorpay', 'failed', 'order_D', NULL, now() - interval '3 days', NULL),
      ('${paid.pE}', '${userId}', 'p30', '30 Days Standard', 30, 24900, 'razorpay', 'paid', 'order_E', 'pay_E', now() - interval '20 days', now() - interval '20 days'),
      ('${paid.pF}', '${otherId}', 'p15', '15 Days Pro', 15, 14900, 'razorpay', 'pending', 'order_F', 'pay_F', now(), NULL);
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), public.is_app_admin() TO authenticated;
    GRANT SELECT ON public.subscription_payments TO authenticated;
  `)

  const migration = await readFile(new URL('../supabase/support_requests.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.exec(migration) // Repeatable migration must keep the same rules.

  const { rows: [grants] } = await db.query(`SELECT
    has_function_privilege('anon', 'public.create_support_request(text,text,text,text,uuid,jsonb)', 'EXECUTE') AS anon_create,
    has_function_privilege('authenticated', 'public.refund_verdict(uuid,uuid,text)', 'EXECUTE') AS user_verdict`)
  assert.equal(grants.anon_create, false, 'anonymous visitors must not raise requests')
  assert.equal(grants.user_verdict, false, 'users must not call the verdict function directly')

  // A signed-in user cannot write the table directly.
  await asUser(userId)
  await assert.rejects(
    db.query(`INSERT INTO public.support_requests (user_id, kind, subject, message) VALUES ('${userId}', 'support', 'Hack', 'a direct insert attempt')`),
    /permission denied/,
    'the requests table must not be writable by users',
  )

  // A support request takes the identity from the token and adds the account snapshot.
  const { rows: [support1] } = await db.query(
    `SELECT * FROM public.create_support_request('support', 'Cannot see my plan', 'My plan still shows locked after paying.', NULL, NULL, $1::jsonb)`,
    [JSON.stringify({ name: 'Ravi', phone: '9999999999', email: 'spoofed@example.org', userId: otherId })],
  )
  assert.equal(support1.status, 'open')
  assert.equal(support1.user_id, userId, 'the owner comes from the token')
  assert.equal(support1.details.accountEmail, 'user@example.org', 'the email comes from the account')
  assert.equal(support1.details.email, 'spoofed@example.org', 'the client may add its own fields, but not overwrite the account snapshot')
  assert.equal(support1.details.userId, userId, 'the server snapshot overrides any claimed userId')
  assert.equal(support1.details.recentPayments.length, 5)

  // Refund rules.
  await assert.rejects(
    db.query(`SELECT * FROM public.create_support_request('refund', 'Refund please', 'I paid for a plan and want money back.', 'duplicate_charge', $1, '{}'::jsonb)`, [paid.pE]),
    /does not qualify/,
    'a single paid payment is not a duplicate charge',
  )
  await assert.rejects(
    db.query(`SELECT * FROM public.create_support_request('refund', 'Refund please', 'I paid for a plan and want money back.', 'duplicate_charge', $1, '{}'::jsonb)`, [paid.pF]),
    /does not qualify|not found/,
    "another user's payment cannot be refunded",
  )
  await assert.rejects(
    db.query(`SELECT * FROM public.create_support_request('refund', 'Refund please', 'Money was taken and no plan.', 'captured_not_active', NULL, '{}'::jsonb)`),
    /Choose the payment/,
    'a refund needs the payment',
  )
  await assert.rejects(
    db.query(`SELECT * FROM public.create_support_request('refund', 'Refund please', 'Money was taken and no plan.', 'something_else', $1, '{}'::jsonb)`, [paid.pC]),
    /Choose a refund reason/,
    'only the three refund reasons are accepted',
  )

  const { rows: [captured] } = await db.query(
    `SELECT * FROM public.create_support_request('refund', 'Charged but no plan', 'Razorpay charged me and my plan did not start.', 'captured_not_active', $1, '{}'::jsonb)`,
    [paid.pC],
  )
  assert.equal(captured.ai_verdict, 'needs_review')
  assert.equal(captured.details.payment.gatewayPaymentId, 'pay_C')
  assert.equal(captured.details.payment.planTitle, '5 Days Trial')

  // One refund request per payment, whatever its state.
  await assert.rejects(
    db.query(`SELECT * FROM public.create_support_request('refund', 'Charged again', 'Same payment again for the record.', 'captured_not_active', $1, '{}'::jsonb)`, [paid.pC]),
    /does not qualify/,
  )

  const { rows: [failed] } = await db.query(
    `SELECT * FROM public.create_support_request('refund', 'Debited after failure', 'My bank shows a debit but the payment failed.', 'failed_but_debited', $1, '{}'::jsonb)`,
    [paid.pD],
  )
  assert.equal(failed.ai_verdict, 'needs_review')

  const { rows: [dup] } = await db.query(
    `SELECT * FROM public.create_support_request('refund', 'Charged twice', 'Two debits for the same 15 day plan.', 'duplicate_charge', $1, '{}'::jsonb)`,
    [paid.pA],
  )
  assert.equal(dup.ai_verdict, 'eligible', 'two paid payments for the same plan within 48 hours are eligible')

  // Five open requests at most (support + three refunds above = 4 open, one more allowed).
  await db.query(`SELECT * FROM public.create_support_request('support', 'Another question', 'How do I change my resume?', NULL, NULL, '{}'::jsonb)`)
  await assert.rejects(
    db.query(`SELECT * FROM public.create_support_request('support', 'Sixth', 'One request too many today.', NULL, NULL, '{}'::jsonb)`),
    /5 open requests/,
    'no more than five open requests per user',
  )

  // A user sees only their own requests.
  const { rows: [mine] } = await db.query('SELECT count(*)::int AS count FROM public.support_requests')
  assert.equal(mine.count, 5)
  await asUser(otherId)
  const { rows: [theirs] } = await db.query('SELECT count(*)::int AS count FROM public.support_requests')
  assert.equal(theirs.count, 0, 'another user must not read these requests')
  await assert.rejects(
    db.query(`SELECT * FROM public.create_support_request('support', 'Other user', 'A request from the other account.', NULL, '${paid.pC}', '{}'::jsonb)`),
    /not found on your account/,
    'a payment from another account cannot be attached',
  )

  // Only an MFA-verified administrator can update a request.
  await asUser(adminId, "SET test.admin = 'true'; SET test.aal = 'aal1'")
  await assert.rejects(
    db.query(`SELECT * FROM public.admin_update_support_request($1, 'resolved', 'Done')`, [support1.id]),
    /verified authenticator/,
    'password-only admins cannot update requests',
  )
  await asUser(adminId, "SET test.admin = 'true'; SET test.aal = 'aal2'")
  const { rows: [updated] } = await db.query(
    `SELECT * FROM public.admin_update_support_request($1, 'resolved', 'Your plan is now active.')`,
    [support1.id],
  )
  assert.equal(updated.status, 'resolved')
  assert.equal(updated.admin_reply, 'Your plan is now active.')
  assert.equal(updated.reviewed_by, adminId)
  assert.ok(updated.resolved_at, 'resolving sets resolved_at')

  // The owner sees the reply; resolved requests no longer count against the open limit.
  await asUser(userId)
  const { rows: [owned] } = await db.query(`SELECT status, admin_reply FROM public.support_requests WHERE id = $1`, [support1.id])
  assert.equal(owned.status, 'resolved')
  assert.equal(owned.admin_reply, 'Your plan is now active.')
  const { rows: [afterResolve] } = await db.query(
    `SELECT * FROM public.create_support_request('support', 'Follow up', 'Thanks, one more question about renewals.', NULL, NULL, '{}'::jsonb)`,
  )
  assert.equal(afterResolve.status, 'open', 'a resolved request frees a slot')

  console.log('support requests SQL: server identity, refund rules, one request per payment, open limit and admin-only updates passed')
} finally {
  await db.close()
}
