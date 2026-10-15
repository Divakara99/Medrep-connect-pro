import { classifyPurchase, parseServiceAccount, purchaseTokenHash } from './googleplay.ts'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}
function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`)
}

Deno.test('service account JSON parses strictly', () => {
  assert(parseServiceAccount(undefined) === null, 'missing secret rejected')
  assert(parseServiceAccount('not json') === null, 'malformed JSON rejected')
  assert(parseServiceAccount('{"client_email":"a@b"}') === null, 'missing key rejected')
  const ok = parseServiceAccount('{"client_email":"svc@proj.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----"}')
  assertEqual(ok?.clientEmail, 'svc@proj.iam.gserviceaccount.com', 'email parsed')
})

Deno.test('purchase tokens are stored only as stable SHA-256 hashes', async () => {
  const a = await purchaseTokenHash('token-one')
  const b = await purchaseTokenHash('token-one')
  const c = await purchaseTokenHash('token-two')
  assertEqual(a, b, 'same token, same hash (idempotency key)')
  assert(a !== c, 'different tokens hash differently')
  assert(/^[a-f0-9]{64}$/.test(a), 'hex sha-256')
  assert(!a.includes('token'), 'raw token never appears in the hash')
})

Deno.test('Play purchase states classify to purchased / pending / cancelled', () => {
  assertEqual(classifyPurchase({ purchaseState: 0 }), 'purchased', '0 = purchased')
  assertEqual(classifyPurchase({ purchaseState: 2 }), 'pending', '2 = pending')
  assertEqual(classifyPurchase({ purchaseState: 1 }), 'cancelled', '1 = cancelled')
  assertEqual(classifyPurchase(null), 'unknown', 'missing purchase is unknown')
  assertEqual(classifyPurchase({}), 'unknown', 'missing state is unknown')
})
