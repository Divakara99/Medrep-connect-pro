import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * The send-push Edge Function, executed for real.
 *
 * supabase/functions/send-push/index.ts is transpiled and run with its Deno and
 * Supabase dependencies replaced by a small stand-in: a fake push service that
 * DECRYPTS every notification it receives (the same RFC 8291 code path a phone
 * uses), and an in-memory database. That makes it possible to prove, on this
 * machine, what the deployed function actually does:
 *
 *   - `config` reports whether keys are set, without ever leaking the private one
 *   - `test` reaches only the caller's own devices
 *   - `notify` fans an announcement out to every enabled device, decrypts
 *     correctly on the phone side, prunes dead endpoints and logs the batch
 *   - the notification text always comes from the server row, never from the
 *     request body — a signed-in account cannot push arbitrary words
 *   - the administrator gate follows the sign-in-code switch, and a vacancy team
 *     member may push a vacancy but not an announcement
 *
 * Nothing here touches the network: the "push service" is local.
 */

const root = new URL('..', import.meta.url)
const dir = await mkdtemp(join(tmpdir(), 'mrc-sendpush-'))

async function transpile(relPath, rewrites = []) {
  const source = await readFile(new URL(relPath, root), 'utf8')
  let rewritten = source
  for (const [from, to] of rewrites) rewritten = rewritten.replaceAll(from, to)
  const js = ts.transpileModule(rewritten, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: relPath,
  }).outputText
  const file = join(dir, relPath.replace(/[^a-z0-9]+/gi, '_') + '.mjs')
  await writeFile(file, js)
  return pathToFileURL(file).href
}

const httpUrl = await transpile('supabase/functions/_shared/http.ts')
const webpushUrl = await transpile('supabase/functions/_shared/webpush.ts')

// ---- Stand-in for supabase/functions/_shared/supabase.ts ----
const shimFile = join(dir, 'supabase_shim.mjs')
await writeFile(shimFile, `
import { adminAccessAllowed } from ${JSON.stringify(httpUrl)}
export { adminAccessAllowed }

// The harness sets this before each call; a real deployment reaches Supabase Auth.
export async function authenticate() {
  const context = globalThis.__mrcContext
  return context ?? new Response(JSON.stringify({ error: 'sign in' }), { status: 401 })
}
export function isResponse(value) { return value instanceof Response }
export function optionsResponse() { return new Response('ok', { status: 200 }) }
export async function adminMfaRequired(client) { return client.__mfaRequired !== false }
`)
const shimUrl = pathToFileURL(shimFile).href

// ---- The function under test: the shipping source, untouched apart from imports ----
const functionUrl = await transpile('supabase/functions/send-push/index.ts', [
  ["'../_shared/supabase.ts'", JSON.stringify(shimUrl)],
  ["'../_shared/http.ts'", JSON.stringify(httpUrl)],
  ["'../_shared/webpush.ts'", JSON.stringify(webpushUrl)],
])

// ---- Deno stand-in ----
const env = {
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
  VAPID_SUBJECT: '',
}
let handler = null
globalThis.Deno = {
  env: { get: (key) => env[key] },
  serve: (fn) => { handler = fn },
}

const webpush = await import(webpushUrl)
const { generateVapidKeys } = webpush
await import(functionUrl)
assert.ok(handler, 'the function must register a request handler with Deno.serve')

// ---- Decrypting push service + in-memory database ----
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { joined.set(part, offset); offset += part.length }
  return joined
}

async function hkdf(ikm, salt, info, bits) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits))
}

/** The phone side: decrypt an aes128gcm push body exactly as a browser does. */
async function decryptOnPhone(body, privateKey, publicBytes, authSecret) {
  const salt = body.slice(0, 16)
  const keyIdLength = body[20]
  assert.equal(keyIdLength, 65, 'the ephemeral key must be an uncompressed P-256 point')
  const serverPublicBytes = body.slice(21, 21 + keyIdLength)
  const ciphertext = body.slice(21 + keyIdLength)
  const serverPublicKey = await crypto.subtle.importKey('raw', serverPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: serverPublicKey }, privateKey, 256))
  const info = concat(encoder.encode('WebPush: info'), new Uint8Array([0]), publicBytes, serverPublicBytes)
  const ikm = await hkdf(shared, authSecret, info, 256)
  const cek = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 128)
  const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 96)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, ciphertext))
  return JSON.parse(decoder.decode(plaintext.slice(0, -1)))
}

/** Register a phone in the fake push service and return its database row. */
async function makePhone({ endpoint, userId, email, status = 201 }) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const authSecret = crypto.getRandomValues(new Uint8Array(16))
  phones.set(endpoint, { privateKey: pair.privateKey, publicBytes, authSecret, status })
  return {
    id: `sub-${endpoint.slice(-6)}`,
    user_id: userId,
    email,
    endpoint,
    p256dh: bytesToBase64Url(publicBytes),
    auth: bytesToBase64Url(authSecret),
    enabled: true,
  }
}

const phones = new Map()
const calls = []
const database = {
  push_subscriptions: [],
  push_delivery_log: [],
  notifications: [],
  vacancies: [],
}

globalThis.fetch = async (url, init) => {
  const endpoint = String(url)
  const phone = phones.get(endpoint)
  const record = { endpoint, headers: init.headers, body: init.body }
  calls.push(record)
  if (!phone) return new Response('unknown endpoint', { status: 404 })
  if (!String(init.headers.Authorization || '').startsWith('vapid t=')) {
    return new Response('missing vapid', { status: 403 })
  }
  record.payload = await decryptOnPhone(init.body, phone.privateKey, phone.publicBytes, phone.authSecret)
  return new Response(null, { status: phone.status })
}

/** Minimal Supabase query builder covering the chains the function uses. */
function makeClient() {
  const client = { __mfaRequired: true, rpc: async () => ({ data: client.__mfaRequired, error: null }) }
  client.from = (table) => {
    const state = { table, filters: [], limit: null, order: null, op: 'select', row: null, single: false }
    const query = {
      select: () => query,
      eq: (column, value) => { state.filters.push({ kind: 'eq', column, value }); return query },
      in: (column, values) => { state.filters.push({ kind: 'in', column, values }); return query },
      limit: (n) => { state.limit = n; return query },
      order: (column, options) => { state.order = { column, ...options }; return query },
      insert: (row) => { state.op = 'insert'; state.row = row; return query },
      delete: () => { state.op = 'delete'; return query },
      maybeSingle: () => { state.single = true; return query.resolve() },
      then: (resolve, reject) => query.resolve().then(resolve, reject),
      async resolve() {
        const rows = database[state.table] ??= []
        if (state.op === 'insert') {
          const inserted = { id: rows.length + 1, ...state.row }
          rows.push(inserted)
          return { data: inserted, error: null }
        }
        const value = (row, column) => {
          if (column === 'data->meta->>jobId') return row.data?.meta?.jobId
          return row[column]
        }
        const matches = rows.filter((row) => state.filters.every((filter) =>
          filter.kind === 'eq' ? value(row, filter.column) === filter.value : filter.values.includes(value(row, filter.column)),
        ))
        if (state.op === 'delete') {
          for (const row of matches) rows.splice(rows.indexOf(row), 1)
          return { data: matches, error: null }
        }
        let result = matches
        if (state.order) {
          result = [...result].sort((a, b) => (state.order.ascending === false ? -1 : 1) * ((a[state.order.column] > b[state.order.column]) ? 1 : -1))
        }
        if (state.limit !== null) result = result.slice(0, state.limit)
        if (state.single) return { data: result[0] ?? null, error: null }
        return { data: result, error: null }
      },
    }
    return query
  }
  return client
}

async function call(body, context) {
  globalThis.__mrcContext = context
  const request = new Request('https://example.supabase.co/functions/v1/send-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const response = await handler(request)
  return { status: response.status, json: await response.json() }
}

const admin = (aal2 = true) => ({
  user: { id: 'admin-1', app_metadata: { role: 'admin' } },
  adminClient: makeClient(),
  aal2,
})
const user = () => ({ user: { id: 'user-1', app_metadata: {} }, adminClient: makeClient(), aal2: false })
const teamMember = () => ({ user: { id: 'team-1', app_metadata: { role: 'vacancy_editor' } }, adminClient: makeClient(), aal2: false })

// ===========================================================================
// 1. config — never leaks the private key
// ===========================================================================
let result = await call({ action: 'config' })
assert.equal(result.status, 200)
assert.equal(result.json.configured, false, 'without secrets the platform reports itself unconfigured')

const vapid = await generateVapidKeys()
env.VAPID_PUBLIC_KEY = vapid.publicKey
env.VAPID_PRIVATE_KEY = vapid.privateKey
env.VAPID_SUBJECT = 'mailto:owner@example.org'

result = await call({ action: 'config' })
assert.equal(result.json.configured, true)
assert.equal(result.json.publicKey, vapid.publicKey, 'the browser receives the public key')
assert.equal(JSON.stringify(result.json).includes(vapid.privateKey), false, 'the private key must never be returned')

// ===========================================================================
// 2. test — only the caller's own devices
// ===========================================================================
const myPhone = await makePhone({ endpoint: 'https://fcm.googleapis.com/fcm/send/phone-mine-1', userId: 'user-1', email: 'me@example.org' })
const myDeadPhone = await makePhone({ endpoint: 'https://fcm.googleapis.com/fcm/send/phone-mine-dead', userId: 'user-1', email: 'me@example.org', status: 410 })
const strangerPhone = await makePhone({ endpoint: 'https://fcm.googleapis.com/fcm/send/phone-stranger', userId: 'user-2', email: 'stranger@example.org' })
database.push_subscriptions.push(myPhone, myDeadPhone, strangerPhone)
calls.length = 0

result = await call({ action: 'test' }, user())
assert.equal(result.json.ok, true)
assert.equal(result.json.devices, 2, 'only the caller’s two devices are used')
assert.equal(result.json.sent, 1, 'the working phone is reported as sent')
assert.equal(calls.length, 2, 'the stranger’s phone is never contacted')
assert.match(calls[0].payload.title, /MedRep Connect Pro/)
assert.match(calls[0].payload.body, /Test notification/)

// ===========================================================================
// 3. notify — an announcement reaches every enabled device and is logged
// ===========================================================================
const otherPhone = await makePhone({ endpoint: 'https://fcm.googleapis.com/fcm/send/phone-other-2', userId: 'user-3', email: 'other@example.org' })
const deadPhone = await makePhone({ endpoint: 'https://fcm.googleapis.com/fcm/send/phone-dead-3', userId: 'user-4', email: 'dead@example.org', status: 410 })
const disabledPhone = await makePhone({ endpoint: 'https://fcm.googleapis.com/fcm/send/phone-off-4', userId: 'user-5', email: 'off@example.org' })
disabledPhone.enabled = false
database.push_subscriptions.push(otherPhone, deadPhone, disabledPhone)
database.notifications.push({
  id: 'n_announce_1',
  data: {
    id: 'n_announce_1',
    title: 'Ten new MR vacancies today',
    body: 'Ten new MR openings are live in Bengaluru.\n\n— Mr. M DIVAKAR REDDY, Business Development Manager, MedRep Connect Pro',
    type: 'update',
    target: 'all',
    createdAt: Date.now(),
    from: 'Mr. M DIVAKAR REDDY · MedRep Connect Pro',
  },
  synced_at: '2026-10-14T00:00:00.000Z',
})
calls.length = 0

result = await call({
  action: 'notify',
  notificationId: 'n_announce_1',
  // A hostile client tries to put its own words on every phone.
  title: 'HACKED',
  body: 'HACKED',
}, admin())

assert.equal(result.status, 200)
assert.equal(result.json.ok, true)
assert.equal(result.json.devices, 5, 'every enabled device is a target')
assert.equal(result.json.sent, 3, 'the two dead endpoints and the disabled one are not counted as sent')
assert.equal(result.json.failed, 2)
assert.equal(result.json.removed, 2, 'dead endpoints are pruned')
assert.equal(calls.length, 5, 'each enabled device was contacted once')

const delivered = calls.map((entry) => entry.payload).filter(Boolean)
assert.ok(delivered.length >= 3)
for (const payload of delivered) {
  assert.equal(payload.title, 'Ten new MR vacancies today', 'the text comes from the server row')
  assert.equal(JSON.stringify(payload).includes('HACKED'), false, 'the request body cannot inject text')
  assert.match(payload.body, /Mr\. M DIVAKAR REDDY/, 'the signed announcement body is intact')
  assert.equal(typeof payload.tag, 'string')
}
assert.equal(database.push_subscriptions.filter((row) => row.endpoint.includes('dead')).length, 0, 'dead rows are deleted')
assert.equal(database.push_delivery_log.length, 1)
assert.deepEqual(
  { sent: database.push_delivery_log[0].sent, failed: database.push_delivery_log[0].failed, removed: database.push_delivery_log[0].removed },
  { sent: 3, failed: 2, removed: 2 },
  'the batch is logged for the admin console',
)

// ===========================================================================
// 4. A private refund notification reaches only the refunded user's devices
// ===========================================================================
database.notifications.push({
  id: 'n_refund_alice',
  data: {
    id: 'n_refund_alice',
    title: 'Refund approved & processed ✅',
    body: 'Your refund of ₹1,234 was processed. Reference: REF-ALICE.',
    type: 'payment',
    target: ['me@example.org'],
    createdAt: Date.now(),
    from: 'MedRep Connect Pro',
    meta: { event: 'refund-processed', paymentId: 'payment-alice' },
  },
  synced_at: new Date().toISOString(),
})
calls.length = 0
result = await call({ action: 'notify', notificationId: 'n_refund_alice' }, admin())
assert.equal(result.status, 200)
assert.equal(result.json.devices, 1, 'only Alice’s enabled phone is selected')
assert.equal(result.json.sent, 1)
assert.equal(calls.length, 1, 'no other account receives the refund push')
assert.equal(calls[0].payload.body.includes('REF-ALICE'), true)

database.notifications.push({
  id: 'n_legacy_refund_broadcast',
  data: {
    id: 'n_legacy_refund_broadcast',
    title: 'Refund approved & processed ✅',
    body: 'Private refund data must not be broadcast.',
    type: 'payment',
    target: 'all',
    createdAt: Date.now(),
    from: 'MedRep Connect Pro',
    meta: { paymentId: 'payment-bob' },
  },
  synced_at: new Date().toISOString(),
})
calls.length = 0
result = await call({ action: 'notify', notificationId: 'n_legacy_refund_broadcast' }, admin())
assert.equal(result.status, 404, 'legacy all-target refund notices are refused by the push function')
assert.equal(calls.length, 0, 'no phone receives a legacy broadcast refund')

// ===========================================================================
// 5. The administrator gate follows the sign-in-code switch
// ===========================================================================
result = await call({ action: 'notify', notificationId: 'n_announce_1' }, user())
assert.equal(result.status, 403, 'a normal account can never push')

const lockedAdmin = admin(false)
lockedAdmin.adminClient.__mfaRequired = true
result = await call({ action: 'notify', notificationId: 'n_announce_1' }, lockedAdmin)
assert.equal(result.status, 403, 'with the code ON, a password-only admin is refused')

const openAdmin = admin(false)
openAdmin.adminClient.__mfaRequired = false
result = await call({ action: 'notify', notificationId: 'n_announce_1' }, openAdmin)
assert.equal(result.status, 200, 'with the code OFF, a password-only admin can send')

result = await call({ action: 'notify', notificationId: 'n_missing' }, admin())
assert.equal(result.status, 404, 'an unknown notice is refused')

// ===========================================================================
// 6. The vacancy team may push a vacancy, but not an announcement
// ===========================================================================
result = await call({ action: 'notify', notificationId: 'n_announce_1' }, teamMember())
assert.equal(result.status, 403, 'the team cannot send announcements')

database.vacancies.push({
  id: 'job-1',
  data: { title: 'Field Officer', category: 'MR', location: 'Bengaluru' },
})

calls.length = 0
result = await call({ action: 'job', jobId: 'job-1' }, teamMember())
assert.equal(result.status, 200, 'the team can push a vacancy it just posted')
assert.equal(result.json.ok, true)
assert.ok(calls.length > 0, 'the vacancy notice really went out')
assert.match(calls[0].payload.title, /MR opening/)
assert.match(calls[0].payload.body, /Field Officer/)

// ===========================================================================
// 7. Malformed and unsupported requests
// ===========================================================================
result = await call({ action: 'delete-everything' }, admin())
assert.equal(result.status, 400)

globalThis.__mrcContext = undefined
const noAuth = await handler(new Request('https://example.supabase.co/functions/v1/send-push', {
  method: 'POST', body: JSON.stringify({ action: 'notify', notificationId: 'n_announce_1' }),
}))
assert.equal(noAuth.status, 401, 'a signed-in account is required')

console.log('send-push function: config, own-device test, announcement fan-out, recipient-only refund push, dead-endpoint pruning, delivery log, switch-aware admin gate and vacancy-team push passed')
