/**
 * AdMob server-side verification (SSV) helpers.
 *
 * Google signs every rewarded-ad callback and GETs it to the
 * admob-reward-verification Edge Function with query parameters:
 *   ad_network, ad_unit, custom_data, reward_amount, reward_item, timestamp,
 *   transaction_id, user_id, signature, key_id
 * The signature is ECDSA P-256 / SHA-256 over the raw query string that
 * precedes `&signature=`, base64url-encoded. Verification keys are published
 * at https://www.gstatic.com/admob/reward/verifier-keys.json — this module
 * never trusts any caller-supplied key material.
 */

export const ADMOB_VERIFIER_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json'

export type SsvParams = {
  adUnit: string
  customData: string
  rewardAmount: string
  rewardItem: string
  timestamp: string
  transactionId: string
  userId: string
  signature: string
  keyId: string
}

/** Extract the SSV parameters, or null when any required one is missing. */
export function parseSsvParams(url: URL): SsvParams | null {
  const get = (name: string) => (url.searchParams.get(name) ?? '').trim()
  const params: SsvParams = {
    adUnit: get('ad_unit'),
    customData: get('custom_data'),
    rewardAmount: get('reward_amount'),
    rewardItem: get('reward_item'),
    timestamp: get('timestamp'),
    transactionId: get('transaction_id'),
    userId: get('user_id'),
    signature: get('signature'),
    keyId: get('key_id'),
  }
  if (!params.adUnit || !params.customData || !params.transactionId || !params.userId
    || !params.signature || !params.keyId) return null
  return params
}

/**
 * The exact byte string Google signed: everything in the raw query string
 * before the `signature` parameter (the signature and any parameters after
 * it are excluded). Returns null when there is no signature parameter.
 */
export function signedContent(url: URL): string | null {
  const rawQuery = url.search.startsWith('?') ? url.search.slice(1) : url.search
  const marker = rawQuery.split('&').findIndex((part) => part.startsWith('signature='))
  if (marker < 0) return null
  return rawQuery.split('&').slice(0, marker).join('&')
}

export type VerifierKeys = { keys: { keyId: string; pem: string }[] }

export function parseVerifierKeys(payload: unknown): VerifierKeys {
  const keys: { keyId: string; pem: string }[] = []
  const list = (payload as { keys?: unknown })?.keys
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      const keyId = record.keyId ?? record.key_id ?? record.keyid
      const pem = record.pem ?? record.publicKey ?? record.public_key
      if ((typeof keyId === 'string' || typeof keyId === 'number') && typeof pem === 'string') {
        keys.push({ keyId: String(keyId), pem })
      }
    }
  }
  return { keys }
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '')
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Google encodes ECDSA signatures in DER form (SEQUENCE of two INTEGERs);
 * WebCrypto expects the raw P1363 form (r ‖ s, 32 bytes each). Convert DER
 * to raw, passing already-raw 64-byte signatures through untouched. Returns
 * null for malformed input.
 */
export function derSignatureToRaw(der: Uint8Array): Uint8Array | null {
  try {
    let offset = 0
    if (der[offset] !== 0x30) return null
    offset += 1
    let length = der[offset]
    offset += 1
    if (length & 0x80) {
      const lengthBytes = length & 0x7f
      if (lengthBytes === 0 || lengthBytes > 2) return null
      length = 0
      for (let i = 0; i < lengthBytes; i += 1) length = (length << 8) | der[offset + i]
      offset += lengthBytes
    }
    if (offset + length !== der.length) return null
    const readInteger = (): Uint8Array | null => {
      if (der[offset] !== 0x02) return null
      offset += 1
      const intLength = der[offset]
      offset += 1
      let bytes = der.slice(offset, offset + intLength)
      offset += intLength
      while (bytes.length > 0 && bytes[0] === 0) bytes = bytes.slice(1)
      if (bytes.length > 32) return null
      const padded = new Uint8Array(32)
      padded.set(bytes, 32 - bytes.length)
      return padded
    }
    const r = readInteger()
    const s = readInteger()
    if (!r || !s) return null
    const raw = new Uint8Array(64)
    raw.set(r, 0)
    raw.set(s, 32)
    return raw
  } catch {
    return null
  }
}

function toRawSignature(signature: Uint8Array): Uint8Array {
  if (signature.length === 64) return signature
  return derSignatureToRaw(signature) ?? signature
}

/** Verify `signature` over `content` with the PEM public key in `pem`. */
export async function verifySsvSignature(
  pem: string,
  content: string,
  signatureBase64Url: string,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<boolean> {
  try {
    const key = await subtle.importKey(
      'spki',
      pemToDer(pem) as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    return await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      toRawSignature(base64UrlToBytes(signatureBase64Url)) as BufferSource,
      new TextEncoder().encode(content) as BufferSource,
    )
  } catch {
    return false
  }
}

let keysCache: { fetchedAt: number; keys: VerifierKeys } | null = null
const KEYS_TTL_MS = 24 * 60 * 60 * 1000

/** Google's current verifier keys, cached for a day (Google's guidance). */
export async function fetchVerifierKeys(fetchFn: typeof fetch = fetch): Promise<VerifierKeys> {
  if (keysCache && Date.now() - keysCache.fetchedAt < KEYS_TTL_MS) return keysCache.keys
  const response = await fetchFn(ADMOB_VERIFIER_KEYS_URL)
  if (!response.ok) throw new Error(`Verifier keys could not be loaded (${response.status}).`)
  const keys = parseVerifierKeys(await response.json())
  if (keys.keys.length === 0) throw new Error('Verifier keys response contained no keys.')
  keysCache = { fetchedAt: Date.now(), keys }
  return keys
}

/**
 * Full check of one callback. `content` must be the string from
 * signedContent(). Unknown key ids fail closed.
 */
export async function verifySsvCallback(input: {
  keys: VerifierKeys
  keyId: string
  signature: string
  content: string
}): Promise<boolean> {
  const candidate = input.keys.keys.find((key) => key.keyId === input.keyId)
  if (!candidate) return false
  return verifySsvSignature(candidate.pem, input.content, input.signature)
}
