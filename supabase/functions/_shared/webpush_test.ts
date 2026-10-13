import { buildPushPayload, buildWebPushRequest, generateVapidKeys, isGoneStatus, sendWebPush } from './webpush.ts'

/**
 * Web Push encryption + VAPID (supabase/functions/_shared/webpush.ts).
 *
 * The tests act as the push service and as the browser: the message is encrypted
 * exactly as production encrypts it, then decrypted with the subscription's
 * private key following RFC 8291, and the VAPID JWT is verified with the public
 * key. No network access, no npm dependency.
 *
 * The same file is executed by the Node suite (scripts/test-webpush-crypto.mjs),
 * so a broken change is caught even without a Deno installation.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bits: number): Promise<Uint8Array> {
  // The casts keep the file type-checkable in Deno, whose lib types want an
  // ArrayBuffer-backed view (the same casts the shipping helper uses).
  const key = await crypto.subtle.importKey('raw', ikm as unknown as BufferSource, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as unknown as BufferSource, info: info as unknown as BufferSource },
    key,
    bits,
  ))
}

/** A browser decrypting what the server sent (RFC 8291). */
async function decrypt(body: Uint8Array, privateKey: CryptoKey, publicBytes: Uint8Array, authSecret: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16)
  const keyIdLength = body[20]
  if (keyIdLength !== 65) throw new Error('the ephemeral public key must be an uncompressed P-256 point')
  const serverPublicBytes = body.slice(21, 21 + keyIdLength)
  const ciphertext = body.slice(21 + keyIdLength)

  const serverPublicKey = await crypto.subtle.importKey(
    'raw', serverPublicBytes as unknown as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  )
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: serverPublicKey }, privateKey, 256))
  const ikm = await hkdf(
    shared,
    authSecret,
    concat(encoder.encode('WebPush: info'), new Uint8Array([0]), publicBytes, serverPublicBytes),
    256,
  )
  const cek = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 128)
  const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 96)
  const key = await crypto.subtle.importKey('raw', cek as unknown as BufferSource, 'AES-GCM', false, ['decrypt'])
  const plaintext = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource, tagLength: 128 },
    key,
    ciphertext as unknown as BufferSource,
  ))
  if (plaintext[plaintext.length - 1] !== 2) throw new Error('the final record must end with the 0x02 delimiter')
  return decoder.decode(plaintext.slice(0, -1))
}

async function browserSubscription() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const authSecret = crypto.getRandomValues(new Uint8Array(16))
  return {
    pair,
    publicBytes,
    authSecret,
    record: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/EXAMPLE-endpoint-1234567890',
      p256dh: bytesToBase64Url(publicBytes),
      auth: bytesToBase64Url(authSecret),
    },
  }
}

Deno.test('encrypted payload decrypts on the device that subscribed', async () => {
  const browser = await browserSubscription()
  const vapid = await generateVapidKeys()
  const keys = { ...vapid, subject: 'mailto:owner@example.org' }
  const payload = buildPushPayload({ title: 'Platform update', body: 'New MR vacancies are live.', notificationId: 'n_test' })

  const request = await buildWebPushRequest(browser.record, payload, keys, { urgency: 'high' })
  if (request.headers['Content-Encoding'] !== 'aes128gcm') throw new Error('aes128gcm encoding must be used')
  if (!request.headers.Authorization.startsWith('vapid t=')) throw new Error('a VAPID authorization header is required')
  if (request.headers.Urgency !== 'high') throw new Error('urgency must be forwarded')

  const decrypted = await decrypt(request.body, browser.pair.privateKey, browser.publicBytes, browser.authSecret)
  if (decrypted !== payload) throw new Error('the decrypted payload must match what was sent')
})

Deno.test('another device key and a tampered body are refused', async () => {
  const browser = await browserSubscription()
  const stranger = await browserSubscription()
  const keys = { ...(await generateVapidKeys()), subject: 'mailto:owner@example.org' }
  const request = await buildWebPushRequest(browser.record, '{"title":"x"}', keys)

  let strangerFailed = false
  try {
    await decrypt(request.body, stranger.pair.privateKey, stranger.publicBytes, stranger.authSecret)
  } catch { strangerFailed = true }
  if (!strangerFailed) throw new Error('a different device must not be able to decrypt the message')

  const tampered = request.body.slice()
  tampered[tampered.length - 1] ^= 0xff
  let tamperFailed = false
  try {
    await decrypt(tampered, browser.pair.privateKey, browser.publicBytes, browser.authSecret)
  } catch { tamperFailed = true }
  if (!tamperFailed) throw new Error('a modified body must fail authentication')
})

Deno.test('VAPID JWT is signed for the push service origin', async () => {
  const browser = await browserSubscription()
  const vapid = await generateVapidKeys()
  const keys = { ...vapid, subject: 'mailto:owner@example.org' }
  const request = await buildWebPushRequest(browser.record, '{"title":"x"}', keys)

  const token = request.headers.Authorization.match(/t=([^,]+)/)?.[1] ?? ''
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) throw new Error('the authorization header must carry a JWT')

  const claims = JSON.parse(decoder.decode(base64UrlToBytes(payload))) as { aud: string; sub: string; exp: number }
  if (claims.aud !== 'https://fcm.googleapis.com') throw new Error('audience must be the push service origin')
  if (claims.sub !== 'mailto:owner@example.org') throw new Error('subject must be the configured contact')
  if (claims.exp * 1000 <= Date.now()) throw new Error('the token must not be expired')

  const verifyKey = await crypto.subtle.importKey(
    'raw', base64UrlToBytes(vapid.publicKey) as unknown as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  )
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifyKey,
    base64UrlToBytes(signature) as unknown as BufferSource,
    encoder.encode(`${header}.${payload}`) as unknown as BufferSource,
  )
  if (!valid) throw new Error('the VAPID JWT signature must verify against the public key')
})

Deno.test('delivery results and payload limits are handled', async () => {
  const browser = await browserSubscription()
  const keys = { ...(await generateVapidKeys()), subject: 'mailto:owner@example.org' }
  const payload = buildPushPayload({ title: 'Hello', body: 'World' })

  const accepted = await sendWebPush(async () => new Response(null, { status: 201 }), browser.record, payload, keys)
  if (!accepted.ok || accepted.gone) throw new Error('a 201 must count as delivered')

  const gone = await sendWebPush(async () => new Response('Gone', { status: 410 }), browser.record, payload, keys)
  if (gone.ok || !gone.gone || !isGoneStatus(410)) throw new Error('410 must mark the subscription as gone')

  const networkDown = await sendWebPush(async () => { throw new Error('offline') }, browser.record, payload, keys)
  if (networkDown.ok || networkDown.status !== 0) throw new Error('a network failure must be reported, not thrown')

  const broken = await sendWebPush(async () => new Response(null, { status: 201 }), { ...browser.record, p256dh: 'nope' }, payload, keys)
  if (broken.ok) throw new Error('an unusable subscription must not be reported as delivered')

  const huge = buildPushPayload({ title: 'A'.repeat(200), body: 'B'.repeat(5000) })
  if (encoder.encode(huge).length > 1000) throw new Error('an oversized announcement must be trimmed')
})
