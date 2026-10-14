import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * Refund notification privacy checks:
 *   - a refund target must be one valid recipient email
 *   - a targeted notice is visible only to that account (including local-cache
 *     filtering), never to another account on the same browser
 *   - legacy all-target refund notices are hidden by the server RPC
 *   - the RPC returns only the current viewer as the private target
 */
const db = new PGlite()
const aliceId = '11111111-1111-4111-8111-111111111111'
const bobId = '22222222-2222-4222-8222-222222222222'

const privacySource = await readFile(new URL('../src/data/notificationPrivacy.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(privacySource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: 'notificationPrivacy.ts',
}).outputText
const moduleFile = join(process.env.TMPDIR || '/tmp', `mrc-notification-privacy-${process.pid}.mjs`)
await writeFile(moduleFile, javascript)
const {
  isBroadcastNotification,
  isRefundNotification,
  notificationAudience,
  notificationVisibleToEmail,
  privateNotificationTarget,
} = await import(pathToFileURL(moduleFile).href)

assert.deepEqual(privateNotificationTarget(' Alice@Example.org '), ['alice@example.org'])
assert.equal(privateNotificationTarget('not-an-email'), null)
assert.equal(notificationAudience(false), 'all')
assert.equal(notificationAudience(true), null, 'refunds cannot default to a broadcast')
assert.equal(notificationAudience(true, 'all'), null, 'refunds cannot use an all-users target')
assert.equal(notificationAudience(true, ['a@example.org', 'b@example.org']), null, 'refunds cannot target multiple accounts')
assert.deepEqual(notificationAudience(true, [' Alice@Example.org ']), ['alice@example.org'])

const aliceRefund = {
  id: 'refund-alice', type: 'payment', title: 'Refund approved & processed ✅',
  body: '₹1,234 · REF-ALICE', target: ['alice@example.org'],
}
const bobRefund = {
  id: 'refund-bob', type: 'payment', title: 'Refund approved & processed ✅',
  body: '₹9,876 · REF-BOB', target: ['bob@example.org'],
}
const oldBroadcastRefund = {
  id: 'refund-old', type: 'payment', title: 'Refund approved & processed ✅',
  body: '₹9,876 · REF-BOB', target: 'all', meta: { paymentId: 'payment-bob' },
}
const multiRecipientRefund = {
  id: 'refund-multi', type: 'payment', title: 'Refund approved & processed ✅',
  body: '₹9,876 · REF-SHARED', target: ['alice@example.org', 'bob@example.org'], meta: { paymentId: 'payment-bob' },
}
const vacancyBroadcast = { id: 'vacancy', type: 'job', title: 'New opening', target: 'all' }
assert.equal(notificationVisibleToEmail(aliceRefund, 'ALICE@example.org'), true)
assert.equal(notificationVisibleToEmail(aliceRefund, 'bob@example.org'), false)
assert.equal(notificationVisibleToEmail(bobRefund, 'alice@example.org'), false)
assert.equal(notificationVisibleToEmail(oldBroadcastRefund, 'alice@example.org'), false)
assert.equal(notificationVisibleToEmail(multiRecipientRefund, 'alice@example.org'), false)
assert.equal(isRefundNotification(oldBroadcastRefund), true)
assert.equal(isBroadcastNotification(oldBroadcastRefund), false)
assert.equal(isBroadcastNotification(vacancyBroadcast), true)

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL);
    INSERT INTO auth.users (id, email) VALUES
      ('${aliceId}', 'alice@example.org'),
      ('${bobId}', 'bob@example.org');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object('email', nullif(current_setting('test.email', true), ''))
    $$;
    CREATE TABLE public.notifications (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      synced_at timestamptz DEFAULT now()
    );
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO authenticated, anon;
  `)

  const baseMigration = await readFile(new URL('../supabase/user_notifications.sql', import.meta.url), 'utf8')
  await db.exec(baseMigration)
  await db.exec(baseMigration) // The full-install notification migration is repeatable too.
  const privacyPatch = await readFile(new URL('../supabase/private_refund_notifications.sql', import.meta.url), 'utf8')
  await db.exec(privacyPatch)
  await db.exec(privacyPatch) // Re-running the privacy patch is safe.

  const { rows: [privileges] } = await db.query(`SELECT
    has_function_privilege('anon', 'public.list_visible_notifications()', 'EXECUTE') AS anon_can_read,
    has_function_privilege('authenticated', 'public.list_visible_notifications()', 'EXECUTE') AS user_can_read`)
  assert.equal(privileges.anon_can_read, false)
  assert.equal(privileges.user_can_read, true)

  const notices = [
    { id: 'broadcast', title: 'New vacancy', body: 'An opening is live.', type: 'job', createdAt: 500, from: 'Admin', target: 'all' },
    { id: 'refund-alice', title: 'Refund approved & processed ✅', body: '₹1,234 · REF-ALICE', type: 'payment', createdAt: 400, from: 'Admin', target: ['Alice@Example.org'], meta: { paymentId: 'payment-alice' } },
    { id: 'refund-bob', title: 'Refund approved & processed ✅', body: '₹9,876 · REF-BOB', type: 'payment', createdAt: 300, from: 'Admin', target: ['bob@example.org'], meta: { paymentId: 'payment-bob' } },
    { id: 'refund-multi', title: 'Refund approved & processed ✅', body: '₹9,876 · REF-SHARED', type: 'payment', createdAt: 250, from: 'Admin', target: ['alice@example.org', 'bob@example.org'], meta: { paymentId: 'payment-bob' } },
    { id: 'legacy-refund', title: 'Refund approved & processed ✅', body: '₹9,876 · REF-BOB', type: 'payment', createdAt: 200, from: 'Admin', target: 'all', meta: { paymentId: 'payment-bob' } },
    { id: 'legacy-title-refund', title: 'Refund processed', body: '₹4,321 · REF-LEAK', type: 'payment', createdAt: 100, from: 'Admin', target: 'all' },
  ]
  for (const notice of notices) {
    await db.query('INSERT INTO public.notifications (id, data) VALUES ($1, $2::jsonb)', [notice.id, JSON.stringify(notice)])
  }

  async function asUser(id, email) {
    await db.exec(`RESET ROLE; SET ROLE authenticated;
      SET request.jwt.claim.sub = '${id}';
      SET test.email = '${email}';`)
  }
  async function visible() {
    return (await db.query('SELECT public.list_visible_notifications() AS notice')).rows.map((row) => row.notice)
  }

  await asUser(aliceId, 'Alice@Example.org')
  const aliceNotices = await visible()
  assert.deepEqual(aliceNotices.map((notice) => notice.id), ['broadcast', 'refund-alice'])
  const alicePrivate = aliceNotices.find((notice) => notice.id === 'refund-alice')
  assert.deepEqual(alicePrivate.target, ['alice@example.org'], 'the RPC exposes only the viewer as a recipient')
  assert.equal(aliceNotices.some((notice) => JSON.stringify(notice).includes('REF-BOB')), false)
  assert.equal(aliceNotices.some((notice) => JSON.stringify(notice).includes('REF-SHARED')), false)
  assert.equal(aliceNotices.some((notice) => JSON.stringify(notice).includes('REF-LEAK')), false)

  await asUser(bobId, 'bob@example.org')
  const bobNotices = await visible()
  assert.deepEqual(bobNotices.map((notice) => notice.id), ['broadcast', 'refund-bob'])
  assert.equal(bobNotices.some((notice) => JSON.stringify(notice).includes('REF-ALICE')), false)
  assert.equal(bobNotices.some((notice) => JSON.stringify(notice).includes('REF-LEAK')), false)

  await db.exec("RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = ''; SET test.email = 'alice@example.org'")
  await assert.rejects(db.query('SELECT public.list_visible_notifications()'), /Sign in to see notifications/)

  await db.exec('RESET ROLE; SET ROLE anon')
  await assert.rejects(db.query('SELECT public.list_visible_notifications()'), /permission denied/)

  console.log('notification privacy: recipient-only refunds, safe local filtering, RPC audience and legacy cleanup passed')
} finally {
  await db.close()
}
