import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

/**
 * Web Push subscription storage (supabase/push_subscriptions.sql), run on top of
 * the real admin_mfa.sql so the admin policies are the shipping ones.
 *
 * Verified here:
 *   - a device is registered against the VERIFIED token identity, never input
 *   - a user sees and removes only their own devices
 *   - re-registering an endpoint on a device that switched accounts moves it
 *     (no notifications leaking to the previous account)
 *   - unusable endpoint/keys are rejected before they reach a push call
 *   - direct writes to the table are impossible; only the stamped RPCs work
 *   - delivery statistics and the delivery log are administrator-only, and they
 *     follow the sign-in code switch
 */
const db = new PGlite()
const userA = '11111111-1111-4111-8111-111111111111'
const userB = '22222222-2222-4222-8222-222222222222'
const adminId = '33333333-3333-4333-8333-333333333333'
const endpointA = 'https://fcm.googleapis.com/fcm/send/AAA-endpoint-one-1234567890'
const endpointB = 'https://fcm.googleapis.com/fcm/send/BBB-endpoint-two-0987654321'
const keys = { p256dh: 'BNcR' + 'a'.repeat(80), auth: 'k' + 'b'.repeat(20) }

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    INSERT INTO auth.users (id, email) VALUES
      ('${userA}', 'first@example.org'),
      ('${userB}', 'second@example.org'),
      ('${adminId}', 'owner@example.org');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT jsonb_build_object(
        'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
        'email', coalesce((SELECT u.email FROM auth.users u WHERE u.id::text = current_setting('request.jwt.claim.sub', true)), ''),
        'app_metadata', jsonb_build_object('role', CASE WHEN current_setting('test.admin', true) = 'true' THEN 'admin' ELSE 'user' END),
        'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1')
      )
    $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO authenticated, anon;
  `)

  // Real migrations, in the documented order.
  await db.exec(await readFile(new URL('../supabase/admin_mfa.sql', import.meta.url), 'utf8'))
  const migration = await readFile(new URL('../supabase/push_subscriptions.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  await db.exec(migration) // Repeatable migration.

  const { rows: [privileges] } = await db.query(`SELECT
    has_function_privilege('anon', 'public.save_push_subscription(text,text,text,text)', 'EXECUTE') AS anon_save,
    has_function_privilege('anon', 'public.delete_push_subscription(text)', 'EXECUTE') AS anon_delete,
    has_function_privilege('anon', 'public.push_subscription_stats()', 'EXECUTE') AS anon_stats,
    has_function_privilege('anon', 'public.my_push_subscriptions()', 'EXECUTE') AS anon_list,
    has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT') AS direct_insert,
    has_table_privilege('authenticated', 'public.push_subscriptions', 'UPDATE') AS direct_update,
    has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT') AS own_select`)
  assert.equal(privileges.anon_save, false)
  assert.equal(privileges.anon_delete, false)
  assert.equal(privileges.anon_stats, false)
  assert.equal(privileges.anon_list, false)
  assert.equal(privileges.direct_insert, false, 'browser sessions must not write the table directly')
  assert.equal(privileges.direct_update, false)
  assert.equal(privileges.own_select, true)

  // ---- User A registers their phone ----
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${userA}'`)
  const { rows: [saved] } = await db.query(
    'SELECT public.save_push_subscription($1, $2, $3, $4) AS result',
    [endpointA, keys.p256dh, keys.auth, 'Mozilla/5.0 (Linux; Android 14) Chrome/141'],
  )
  assert.equal(saved.result.ok, true)

  const { rows: [row] } = await db.query(
    'SELECT user_id, email, enabled FROM public.push_subscriptions WHERE endpoint = $1', [endpointA],
  )
  assert.equal(row.user_id, userA, 'the row belongs to the verified token subject')
  assert.equal(row.email, 'first@example.org', 'the email comes from the token, not the request body')
  assert.equal(row.enabled, true)

  await assert.rejects(
    db.query("INSERT INTO public.push_subscriptions (user_id, email, endpoint, p256dh, auth) VALUES ($1,'x','https://e/x','k','a')", [userB]),
    /permission denied|row-level security/i,
    'a session cannot plant a subscription row directly',
  )

  // ---- Another user sees nothing of it ----
  await db.exec(`SET request.jwt.claim.sub = '${userB}'`)
  const { rows: foreignRows } = await db.query('SELECT count(*)::int AS count FROM public.push_subscriptions')
  assert.equal(foreignRows[0].count, 0, 'subscriptions are not listable across accounts')
  const { rows: foreignList } = await db.query('SELECT count(*)::int AS count FROM public.my_push_subscriptions()')
  assert.equal(foreignList[0].count, 0)
  const { rows: [foreignDelete] } = await db.query(
    'SELECT public.delete_push_subscription($1) AS result', [endpointA],
  )
  assert.equal(foreignDelete.result.removed, 0, 'another account cannot switch off my device')
  // Read back as the owner: the device row must still be there.
  await db.exec(`SET request.jwt.claim.sub = '${userA}'`)
  const { rows: [stillThere] } = await db.query('SELECT count(*)::int AS count FROM public.push_subscriptions WHERE endpoint = $1', [endpointA])
  assert.equal(stillThere.count, 1)
  await db.exec(`SET request.jwt.claim.sub = '${userB}'`)

  // ---- Same device, new account: ownership moves with the sign-in ----
  await db.query('SELECT public.save_push_subscription($1, $2, $3, $4)', [endpointA, keys.p256dh, keys.auth, 'Mozilla/5.0 (Linux; Android 14) Chrome/141'])
  const { rows: [moved] } = await db.query('SELECT user_id, email FROM public.push_subscriptions WHERE endpoint = $1', [endpointA])
  assert.equal(moved.user_id, userB, 'the device now belongs to the account that signed in last')
  assert.equal(moved.email, 'second@example.org')
  await db.exec(`SET request.jwt.claim.sub = '${userA}'`)
  const { rows: noLongerMine } = await db.query('SELECT count(*)::int AS count FROM public.my_push_subscriptions()')
  assert.equal(noLongerMine[0].count, 0, 'the previous account no longer receives this device’s notifications')

  // ---- Unusable input is refused ----
  await db.exec(`SET request.jwt.claim.sub = '${userA}'`)
  await assert.rejects(
    db.query('SELECT public.save_push_subscription($1, $2, $3)', ['short', keys.p256dh, keys.auth]),
    /unusable notification endpoint/,
  )
  await assert.rejects(
    db.query('SELECT public.save_push_subscription($1, $2, $3)', [endpointB, 'tiny', keys.auth]),
    /unusable notification keys/,
  )

  // ---- A second device for A, then the phone only turns its own one off ----
  await db.query('SELECT public.save_push_subscription($1, $2, $3, $4)', [endpointB, keys.p256dh, keys.auth, 'Mozilla/5.0 (iPhone) Safari'])
  const { rows: twoDevices } = await db.query('SELECT count(*)::int AS count FROM public.my_push_subscriptions()')
  assert.equal(twoDevices[0].count, 1, 'A has one device left; the other one moved to B')
  await db.exec(`SET request.jwt.claim.sub = '${userB}'`)
  const { rows: oneDevice } = await db.query('SELECT count(*)::int AS count FROM public.my_push_subscriptions()')
  assert.equal(oneDevice[0].count, 1)
  const { rows: [disabled] } = await db.query('SELECT public.delete_push_subscription($1) AS result', [endpointA])
  assert.equal(disabled.result.removed, 1, 'turning notifications off removes that device')
  const { rows: afterDisable } = await db.query('SELECT count(*)::int AS count FROM public.my_push_subscriptions()')
  assert.equal(afterDisable[0].count, 0)

  // ---- Delivery statistics are administrator-only ----
  await db.exec(`SET request.jwt.claim.sub = '${userA}'; SET test.admin = 'false'`)
  await assert.rejects(
    db.query('SELECT public.push_subscription_stats()'),
    /Only an administrator/,
    'a normal user cannot read delivery statistics',
  )
  // RLS filters the delivery log for a normal user rather than erroring: the
  // table grants SELECT, but the admin policy hides every row.
  await db.exec(`SET request.jwt.claim.sub = '${userA}'; SET test.admin = 'false'`)
  const { rows: hiddenLog } = await db.query('SELECT count(*)::int AS count FROM public.push_delivery_log')
  assert.equal(hiddenLog[0].count, 0, 'the delivery log is invisible to users')

  await db.exec(`SET request.jwt.claim.sub = '${adminId}'; SET test.admin = 'true'; SET test.aal = 'aal2'`)
  const { rows: [stats] } = await db.query('SELECT public.push_subscription_stats() AS stats')
  assert.equal(Number(stats.stats.devices), 1, 'one device is reachable (user A’s iPhone)')
  assert.equal(Number(stats.stats.people), 1)
  assert.deepEqual(stats.stats.recent, [])

  // With the sign-in code switch OFF, the password-only admin console sees the
  // same numbers (the switch governs admin access everywhere).
  const { rows: [switched] } = await db.query('SELECT public.set_admin_mfa_required(false) AS state')
  assert.equal(switched.state.mfaRequired, false, 'a verified administrator can switch the code off')
  await db.exec("SET test.aal = 'aal1'")
  const { rows: [unverifiedStats] } = await db.query('SELECT public.push_subscription_stats() AS stats')
  assert.equal(Number(unverifiedStats.stats.devices), 1, 'the code switch applies to delivery stats too')

  // The service role (the send-push function) writes the delivery log.
  await db.exec(`
    RESET ROLE;
    INSERT INTO public.push_delivery_log (notification_id, title, sent, failed, removed)
    VALUES ('n_test', 'Platform update', 3, 1, 1);
  `)
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${adminId}'; SET test.admin = 'true'; SET test.aal = 'aal1'`)
  const { rows: [withLog] } = await db.query('SELECT public.push_subscription_stats() AS stats')
  assert.equal(Number(withLog.stats.lastBatch.sent), 3)
  assert.equal(Number(withLog.stats.recent.length), 1)
  const { rows: [logRead] } = await db.query('SELECT count(*)::int AS count FROM public.push_delivery_log')
  assert.equal(logRead.count, 1, 'administrators can read the delivery log')

  console.log('push subscriptions SQL: stamped identity, own-device only, endpoint takeover and admin-only stats passed')
} finally {
  await db.close()
}
