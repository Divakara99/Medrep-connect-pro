import {
  derSignatureToRaw,
  parseSsvParams,
  parseVerifierKeys,
  signedContent,
  verifySsvCallback,
  verifySsvSignature,
} from './admob.ts'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

Deno.test('SSV params parse and the signed content ends before signature', () => {
  const url = new URL(
    'https://example.test/cb?ad_network=1&ad_unit=ca-app-pub-x%2F1&custom_data=job-1&reward_amount=1'
    + '&reward_item=company&timestamp=1700000000000&transaction_id=tx-1&user_id=user-1&signature=abc&key_id=42',
  )
  const params = parseSsvParams(url)
  assert(params !== null, 'params should parse')
  assert(params?.customData === 'job-1', 'custom_data is the job id')
  assert(params?.userId === 'user-1', 'user_id is the Supabase user id')
  assert(
    signedContent(url) === 'ad_network=1&ad_unit=ca-app-pub-x%2F1&custom_data=job-1&reward_amount=1&reward_item=company&timestamp=1700000000000&transaction_id=tx-1&user_id=user-1',
    'signed content must be the exact query prefix before signature',
  )
  assert(parseSsvParams(new URL('https://example.test/cb?ad_unit=x')) === null, 'incomplete callbacks are rejected')
})

Deno.test('verifier keys parse (keyId + pem, key_id tolerated)', () => {
  const keys = parseVerifierKeys({
    keys: [
      { keyId: 42, pem: '-----BEGIN PUBLIC KEY-----\nAA==\n-----END PUBLIC KEY-----' },
      { key_id: '43', pem: 'pem-43' },
      { nope: true },
    ],
  })
  assert(keys.keys.length === 2, 'two usable keys')
  assert(keys.keys[0].keyId === '42', 'numeric key ids are stringified')
})

function pemFromDer(der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)))
  const lines = base64.match(/.{1,64}/g)?.join('\n') ?? base64
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const encodeInteger = (bytes: Uint8Array): number[] => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1
    let value = bytes.slice(start)
    if (value[0] & 0x80) {
      const padded = new Uint8Array(value.length + 1)
      padded.set(value, 1)
      value = padded
    }
    return [0x02, value.length, ...value]
  }
  const body = [...encodeInteger(raw.slice(0, 32)), ...encodeInteger(raw.slice(32, 64))]
  return new Uint8Array([0x30, body.length, ...body])
}

Deno.test('Google DER-encoded signatures convert to raw and verify', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const der = await crypto.subtle.exportKey('spki', pair.publicKey)
  const pem = pemFromDer(der)
  const content = 'ad_unit=unit&custom_data=job-1&transaction_id=tx&user_id=u1'
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(content)),
  )
  const derSignature = rawToDer(raw)
  const roundTripped = derSignatureToRaw(derSignature)
  if (!roundTripped) throw new Error('DER conversion returned null')
  assert(roundTripped.length === 64, 'DER converts to 64-byte raw')
  assert(roundTripped.every((byte, i) => byte === raw[i]), 'DER round-trip preserves r and s')
  assert(await verifySsvSignature(pem, content, base64Url(derSignature)), 'a DER signature from Google verifies')
  assert(!(await verifySsvSignature(pem, `${content}x`, base64Url(derSignature))), 'DER signature fails for other content')
  assert(derSignatureToRaw(new Uint8Array([1, 2, 3])) === null, 'garbage is not a DER signature')
})

Deno.test('ECDSA SSV signature verifies and tampering fails', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const der = await crypto.subtle.exportKey('spki', pair.publicKey)
  const pem = pemFromDer(der)
  const content = 'ad_unit=unit&custom_data=job-1&transaction_id=tx&user_id=u1'
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(content)),
  )
  assert(await verifySsvSignature(pem, content, base64Url(signature)), 'a genuine Google-style signature verifies')
  assert(!(await verifySsvSignature(pem, content.replace('job-1', 'job-2'), base64Url(signature))), 'tampered content fails')
  assert(
    await verifySsvCallback({ keys: { keys: [{ keyId: '7', pem }] }, keyId: '7', signature: base64Url(signature), content }),
    'callback verification resolves the key by id',
  )
  assert(
    !(await verifySsvCallback({ keys: { keys: [{ keyId: '7', pem }] }, keyId: 'unknown', signature: base64Url(signature), content })),
    'unknown key ids fail closed',
  )
})
