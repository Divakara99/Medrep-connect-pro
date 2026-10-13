/**
 * Web Push over VAPID + aes128gcm (RFC 8291 / RFC 8188 / RFC 8292), implemented
 * with plain WebCrypto.
 *
 * Why hand-rolled instead of an npm package: this module is imported by the
 * send-push Edge Function and by the Node test suite in this repository, and it
 * uses nothing but `crypto.subtle` — so the exact code that will run in
 * production is the code the tests exercise. No Deno-only API, no dependency to
 * keep patched.
 *
 * What it does:
 *   1. builds the message body the push service expects: a 16-byte salt, a
 *      record size, the ephemeral public key, then the payload encrypted with
 *      AES-128-GCM under keys derived with HKDF from the subscription's keys;
 *   2. signs a VAPID JWT (ES256) for the push service origin, so the service
 *      knows which application server sent the message.
 *
 * Key formats (same as `web-push generate-vapid-keys`):
 *   public  : base64url of the 65-byte uncompressed P-256 point
 *   private : base64url of the 32-byte P-256 scalar
 */

export type VapidKeys = {
  publicKey: string
  privateKey: string
  subject: string
}

export type PushSubscriptionRecord = {
  endpoint: string
  p256dh: string
  auth: string
}

export type WebPushRequest = {
  endpoint: string
  headers: Record<string, string>
  body: Uint8Array
}

/** Push services answer 404/410 for a subscription that no longer exists. */
export function isGoneStatus(status: number): boolean {
  return status === 404 || status === 410
}

const encoder = new TextEncoder()

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').trim()
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
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
  const key = await crypto.subtle.importKey('raw', ikm as unknown as BufferSource, 'HKDF', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as unknown as BufferSource, info: info as unknown as BufferSource },
    key,
    bits,
  )
  return new Uint8Array(derived)
}

/** A fresh VAPID key pair, ready to paste into Supabase secrets. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  if (!jwk.d) throw new Error('The generated key pair has no private component.')
  return { publicKey: bytesToBase64Url(publicBytes), privateKey: jwk.d }
}

async function importVapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const publicBytes = base64UrlToBytes(keys.publicKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY must be the base64url of an uncompressed P-256 point.')
  }
  const x = bytesToBase64Url(publicBytes.slice(1, 33))
  const y = bytesToBase64Url(publicBytes.slice(33, 65))
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x,
    y,
    d: keys.privateKey.replace(/=+$/, ''),
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

/**
 * The `Authorization` header value for one push service origin
 * (`vapid t=<jwt>, k=<public key>`), valid for 12 hours.
 */
export async function vapidAuthorization(keys: VapidKeys, endpoint: string, now = Date.now()): Promise<string> {
  const audience = new URL(endpoint).origin
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: keys.subject,
  })))
  const signingInput = `${header}.${payload}`
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importVapidSigningKey(keys),
    encoder.encode(signingInput),
  ))
  const token = `${signingInput}.${bytesToBase64Url(signature)}`
  return `vapid t=${token}, k=${keys.publicKey.replace(/=+$/, '')}`
}

/**
 * Build the encrypted request for one subscription. The record size is set to
 * the full plaintext + tag so a single record always fits, which is what every
 * push service expects for small payloads.
 */
export async function buildWebPushRequest(
  subscription: PushSubscriptionRecord,
  payload: string,
  keys: VapidKeys,
  options: { ttlSeconds?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; now?: number } = {},
): Promise<WebPushRequest> {
  const userPublicBytes = base64UrlToBytes(subscription.p256dh)
  if (userPublicBytes.length !== 65 || userPublicBytes[0] !== 0x04) {
    throw new Error('The subscription public key is not an uncompressed P-256 point.')
  }
  const authSecret = base64UrlToBytes(subscription.auth)

  const userPublicKey = await crypto.subtle.importKey(
    'raw',
    userPublicBytes as unknown as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: userPublicKey },
    ephemeral.privateKey,
    256,
  ))
  const ephemeralPublicBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeral.publicKey),
  )

  const salt = crypto.getRandomValues(new Uint8Array(16))
  // RFC 8291 §3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" || ua_pub || as_pub)
  const ikm = await hkdf(
    sharedSecret,
    authSecret,
    concatBytes(encoder.encode('WebPush: info'), new Uint8Array([0]), userPublicBytes, ephemeralPublicBytes),
    256,
  )
  const contentEncryptionKey = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 128)
  const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 96)

  const aesKey = await crypto.subtle.importKey(
    'raw',
    contentEncryptionKey as unknown as BufferSource,
    'AES-GCM',
    false,
    ['encrypt'],
  )
  // 0x02 marks the final (and here only) record of the message.
  const plaintext = concatBytes(encoder.encode(payload), new Uint8Array([2]))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource, tagLength: 128 },
    aesKey,
    plaintext as unknown as BufferSource,
  ))

  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, ciphertext.length, false)
  const header = concatBytes(
    salt,
    recordSize,
    new Uint8Array([ephemeralPublicBytes.length]),
    ephemeralPublicBytes,
  )

  const headers: Record<string, string> = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(options.ttlSeconds ?? 60 * 60 * 24),
    Authorization: await vapidAuthorization(keys, subscription.endpoint, options.now),
  }
  if (options.urgency) headers.Urgency = options.urgency

  return { endpoint: subscription.endpoint, headers, body: concatBytes(header, ciphertext) }
}

export type WebPushResult = {
  ok: boolean
  status: number
  /** The push service reports the subscription as gone — remove it. */
  gone: boolean
}

/** Send one message. `fetchImpl` keeps this testable without network access. */
export async function sendWebPush(
  fetchImpl: typeof fetch,
  subscription: PushSubscriptionRecord,
  payload: string,
  keys: VapidKeys,
  options: { ttlSeconds?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; now?: number } = {},
): Promise<WebPushResult> {
  try {
    const request = await buildWebPushRequest(subscription, payload, keys, options)
    const response = await fetchImpl(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: request.body as unknown as BodyInit,
    })
    return { ok: response.ok, status: response.status, gone: isGoneStatus(response.status) }
  } catch {
    // A malformed subscription or a push service that refused the request both
    // mean "not delivered" — never throw into the caller's fan-out loop.
    return { ok: false, status: 0, gone: false }
  }
}

export type PushMessage = {
  title: string
  body: string
  url?: string
  tag?: string
  notificationId?: string
  type?: string
}

/** A compact JSON payload; push services reject anything above ~4 KB. */
export function buildPushPayload(message: PushMessage): string {
  const payload = JSON.stringify({
    title: (message.title || 'MedRep Connect Pro').slice(0, 120),
    body: (message.body || '').slice(0, 400),
    url: message.url || './index.html',
    tag: message.tag || message.notificationId || 'mrc-update',
    notificationId: message.notificationId,
    type: message.type || 'update',
  })
  if (encoder.encode(payload).length > 3000) {
    return JSON.stringify({
      title: (message.title || 'MedRep Connect Pro').slice(0, 120),
      body: (message.body || '').slice(0, 160),
      url: './index.html',
      tag: 'mrc-update',
      type: message.type || 'update',
    })
  }
  return payload
}
