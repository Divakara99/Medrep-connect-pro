import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * Web Push encryption (supabase/functions/_shared/webpush.ts).
 *
 * The module the Edge Function ships is transpiled here and exercised as a push
 * service would see it:
 *   - a browser-style subscription key pair is created, the message is
 *     encrypted, and it is then DECRYPTED with the subscription's private key,
 *     following RFC 8291 (HKDF + aes128gcm) exactly as a browser does;
 *   - the VAPID JWT is verified against the public key, and its audience/expiry/
 *     subject claims are checked;
 *   - a wrong key, a tampered body, a dead endpoint (410) and an oversized
 *     payload are all handled the way production must handle them.
 *
 * Nothing here needs a network or a real push service.
 */
const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function loadModule() {
  const source = await readFile(new URL('../supabase/functions/_shared/webpush.ts', import.meta.url), 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: 'webpush.ts',
  }).outputText
  const file = join(process.env.TMPDIR || '/tmp', `webtest-${process.pid}.mjs`)
  await writeFile(file, javascript)
  return { module: await import(pathToFileURL(file).href), url: pathToFileURL(file).href, file }
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function bytesToBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hkdf(ikm, salt, info, bits) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits))
}

/** The browser side of RFC 8291: decrypt what the server encrypted. */
async function decryptWebPush(body, subscriptionPrivateKey, subscriptionPublicBytes, authSecret) {
  const salt = body.slice(0, 16)
  const keyIdLength = body[20]
  assert.equal(keyIdLength, 65, 'the ephemeral public key is an uncompressed P-256 point')
  const serverPublicBytes = body.slice(21, 21 + keyIdLength)
  const ciphertext = body.slice(21 + keyIdLength)

  const serverPublicKey = await crypto.subtle.importKey(
    'raw', serverPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  )
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: serverPublicKey }, subscriptionPrivateKey, 256,
  ))
  const ikm = await hkdf(
    sharedSecret,
    authSecret,
    Buffer.concat([
      encoder.encode('WebPush: info'),
      new Uint8Array([0]),
      subscriptionPublicBytes,
      serverPublicBytes,
    ]),
    256,
  )
  const cek = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 128)
  const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 96)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plaintext = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, ciphertext,
  ))
  // The final record ends with the 0x02 padding delimiter.
  assert.equal(plaintext[plaintext.length - 1], 2, 'the last record is marked as final')
  return decoder.decode(plaintext.slice(0, -1))
}

const webpushModule = await loadModule()
const webpush = webpushModule.module

// ---- A "browser" subscription ----
const browserKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
const browserPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', browserKeys.publicKey))
const authSecret = crypto.getRandomValues(new Uint8Array(16))
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/EXAMPLE-endpoint-1234567890',
  p256dh: bytesToBase64Url(browserPublicBytes),
  auth: bytesToBase64Url(authSecret),
}

// ---- The application server keys ----
const vapid = await webpush.generateVapidKeys()
assert.equal(base64UrlToBytes(vapid.publicKey).length, 65, 'VAPID public key is 65 bytes')
assert.equal(base64UrlToBytes(vapid.privateKey).length, 32, 'VAPID private key is 32 bytes')
const keys = { ...vapid, subject: 'mailto:owner@example.org' }

// ---- Encrypt ----
const payload = webpush.buildPushPayload({
  title: 'Platform update',
  body: 'New MR vacancies are live in Chennai.',
  notificationId: 'n_abc123',
})
const request = await webpush.buildWebPushRequest(subscription, payload, keys, { urgency: 'high' })
assert.equal(request.endpoint, subscription.endpoint)
assert.equal(request.headers['Content-Encoding'], 'aes128gcm')
assert.equal(request.headers['Content-Type'], 'application/octet-stream')
assert.equal(request.headers.Urgency, 'high')
assert.equal(request.headers.TTL, String(24 * 60 * 60))
assert.ok(request.headers.Authorization.startsWith('vapid t='), 'the VAPID authorization header is used')

// ---- The browser decrypts exactly what the server encrypted ----
const decrypted = await decryptWebPush(request.body, browserKeys.privateKey, browserPublicBytes, authSecret)
assert.deepEqual(JSON.parse(decrypted), JSON.parse(payload))
assert.equal(JSON.parse(decrypted).title, 'Platform update')

// A different subscription key must NOT be able to read it.
const otherKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
await assert.rejects(
  decryptWebPush(request.body, otherKeys.privateKey, browserPublicBytes, authSecret),
  'another device’s key must not decrypt the message',
)
// A tampered body must fail authentication (AES-GCM tag).
const tampered = request.body.slice()
tampered[tampered.length - 1] ^= 0xff
await assert.rejects(
  decryptWebPush(tampered, browserKeys.privateKey, browserPublicBytes, authSecret),
  'a modified body must not decrypt',
)

// ---- Two requests to the same endpoint are never identical (fresh salt/key) ----
const second = await webpush.buildWebPushRequest(subscription, payload, keys)
assert.notDeepEqual(Array.from(second.body.slice(0, 16)), Array.from(request.body.slice(0, 16)))

// ---- The VAPID JWT verifies against the public key ----
const token = request.headers.Authorization.match(/t=([^,]+)/)[1]
const [jwtHeader, jwtPayload, jwtSignature] = token.split('.')
assert.deepEqual(JSON.parse(decoder.decode(base64UrlToBytes(jwtHeader))), { typ: 'JWT', alg: 'ES256' })
const claims = JSON.parse(decoder.decode(base64UrlToBytes(jwtPayload)))
assert.equal(claims.aud, 'https://fcm.googleapis.com', 'the audience is the push service origin')
assert.equal(claims.sub, 'mailto:owner@example.org')
assert.ok(claims.exp > Math.floor(Date.now() / 1000), 'the token has not expired')

const verifyKey = await crypto.subtle.importKey(
  'raw', base64UrlToBytes(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
)
const signatureOk = await crypto.subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' },
  verifyKey,
  base64UrlToBytes(jwtSignature),
  encoder.encode(`${jwtHeader}.${jwtPayload}`),
)
assert.equal(signatureOk, true, 'the JWT signature must verify with the public key')
assert.equal(
  request.headers.Authorization.split('k=')[1], vapid.publicKey,
  'the public key rides along with the token, as push services expect',
)

// ---- Delivery handling ----
const gone = await webpush.sendWebPush(
  async () => new Response('Gone', { status: 410 }),
  subscription, payload, keys,
)
assert.deepEqual(gone, { ok: false, status: 410, gone: true }, '410 means the device is gone and must be removed')

const accepted = await webpush.sendWebPush(
  async (_url, init) => {
    assert.equal(init.method, 'POST')
    return new Response(null, { status: 201 })
  },
  subscription, payload, keys,
)
assert.deepEqual(accepted, { ok: true, status: 201, gone: false })

const broken = await webpush.sendWebPush(
  async () => { throw new Error('network down') },
  subscription, payload, keys,
)
assert.deepEqual(broken, { ok: false, status: 0, gone: false }, 'a network failure never throws')

const badKeys = await webpush.sendWebPush(
  async () => new Response(null, { status: 201 }),
  { ...subscription, p256dh: 'not-a-point' }, payload, keys,
)
assert.deepEqual(badKeys, { ok: false, status: 0, gone: false }, 'an unusable subscription is reported, not thrown')

// ---- Payload shaping ----
assert.deepEqual(Object.keys(JSON.parse(payload)).sort(), ['body', 'notificationId', 'tag', 'title', 'type', 'url'])
const huge = webpush.buildPushPayload({ title: 'A'.repeat(200), body: 'B'.repeat(5000), type: 'update' })
assert.ok(encoder.encode(huge).length < 1000, 'an oversized announcement is trimmed instead of rejected by the push service')

// ---- The Deno test file CI runs, executed here through a shim ----
// (Deno is not installed in every environment, so the same file is executed by
// this Node suite against the same transpiled module.)
const collected = []
globalThis.Deno = { test: (name, fn) => collected.push([name, fn]) }
const denoTestSource = await readFile(new URL('../supabase/functions/_shared/webpush_test.ts', import.meta.url), 'utf8')
const denoTestJs = ts.transpileModule(
  denoTestSource.replace("from './webpush.ts'", `from '${webpushModule.url}'`),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, fileName: 'webpush_test.ts' },
).outputText
const denoTestFile = join(process.env.TMPDIR || '/tmp', `webtest-deno-${process.pid}.mjs`)
await writeFile(denoTestFile, denoTestJs)
await import(pathToFileURL(denoTestFile).href)
assert.ok(collected.length >= 4, 'the Deno test file must register its tests')
for (const [name, fn] of collected) {
  await fn()
  console.log(`  deno test ok: ${name}`)
}

console.log('web push: RFC 8291 encryption round-trips, VAPID JWT verifies, gone endpoints and bad keys handled')
