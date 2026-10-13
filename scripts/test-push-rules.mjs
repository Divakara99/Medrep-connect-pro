import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * Phone-notification rules (src/data/pushRules.ts — the shipping source).
 *
 * These decide what the notification card offers, what an announcement is
 * allowed to say, and which arrivals are worth a ring. They are pure functions
 * so the screens cannot drift from the rules the tests pin here.
 */
const source = await readFile(new URL('../src/data/pushRules.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: 'pushRules.ts',
}).outputText
const file = join(process.env.TMPDIR || '/tmp', `mrc-pushrules-${process.pid}.mjs`)
await writeFile(file, javascript)
const rules = await import(pathToFileURL(file).href)

const {
  announcementBody, announcementProblem, base64UrlToBytes, isValidPushKey,
  nextWatermark, notificationsToAlert, pushAvailability, pushAvailabilityMessage, shouldChime,
} = rules

// ---- The VAPID public key must be a real uncompressed P-256 point ----
const KEY_LENGTH = 65
const goodKey = (() => {
  const bytes = Buffer.alloc(KEY_LENGTH)
  bytes[0] = 0x04
  for (let i = 1; i < KEY_LENGTH; i += 1) bytes[i] = i
  return bytes.toString('base64url')
})()
assert.equal(isValidPushKey(goodKey), true, 'a 65-byte 0x04 key is valid')
const shortKey = Buffer.alloc(KEY_LENGTH - 1, 7).toString('base64url')
assert.equal(isValidPushKey(shortKey), false, 'a truncated key is rejected')
const wrongPrefix = Buffer.alloc(KEY_LENGTH, 7)
wrongPrefix[0] = 0x02
assert.equal(isValidPushKey(wrongPrefix.toString('base64url')), false, 'a compressed point is rejected')
assert.equal(isValidPushKey(''), false)
assert.equal(isValidPushKey(null), false)
assert.equal(isValidPushKey('!!!not base64!!!'), false)
assert.equal(base64UrlToBytes(goodKey).length, KEY_LENGTH, 'base64url decoding keeps every byte')
assert.deepEqual([...base64UrlToBytes(goodKey).slice(0, 3)], [0x04, 0x01, 0x02])

// ---- What the card offers, in every realistic state ----
assert.equal(pushAvailability({ supported: false, permission: 'unsupported', subscribed: false, standalone: false, isIos: false }), 'unsupported')
assert.equal(pushAvailability({ supported: true, permission: 'default', subscribed: false, standalone: false, isIos: false }), 'ask')
assert.equal(pushAvailability({ supported: true, permission: 'denied', subscribed: false, standalone: false, isIos: false }), 'denied')
assert.equal(pushAvailability({ supported: true, permission: 'granted', subscribed: false, standalone: false, isIos: false }), 'off')
assert.equal(pushAvailability({ supported: true, permission: 'granted', subscribed: true, standalone: false, isIos: false }), 'on')
assert.equal(
  pushAvailability({ supported: true, permission: 'default', subscribed: false, standalone: false, isIos: true }),
  'needs-install',
  'iPhone push needs the app on the Home Screen first',
)
assert.equal(
  pushAvailability({ supported: true, permission: 'default', subscribed: false, standalone: true, isIos: true }),
  'ask',
  'an installed iPhone app can ask normally',
)
// The server side may still be missing its keys — that is its own honest state.
assert.equal(
  pushAvailability({ supported: true, permission: 'default', subscribed: false, standalone: false, isIos: false, platformReady: false }),
  'platform-off',
)
assert.equal(
  pushAvailability({ supported: true, permission: 'granted', subscribed: false, standalone: false, isIos: false, platformReady: false }),
  'platform-off',
  'even an allowed browser cannot subscribe without the server key',
)
assert.equal(
  pushAvailability({ supported: true, permission: 'denied', subscribed: false, standalone: false, isIos: false, platformReady: false }),
  'denied',
  'an explicit block is reported before the platform state',
)
// Blocked beats everything except "not supported" and "needs install".
assert.equal(pushAvailability({ supported: true, permission: 'denied', subscribed: true, standalone: false, isIos: false }), 'denied')

const messages = ['unsupported', 'needs-install', 'denied', 'ask', 'off', 'on', 'platform-off'].map(pushAvailabilityMessage)
for (const text of messages) assert.ok(text && text.length > 20, 'every state explains itself in plain words')
assert.match(pushAvailabilityMessage('denied'), /blocked/i)
assert.match(pushAvailabilityMessage('needs-install'), /Home Screen/i)
assert.match(pushAvailabilityMessage('platform-off'), /platform/i)

// ---- Announcement validation ----
assert.match(announcementProblem('', 'x'.repeat(20)), /title/i)
assert.match(announcementProblem('ab', 'x'.repeat(20)), /title/i)
assert.match(announcementProblem('Vacancies today', 'short'), /at least 10/i)
assert.equal(announcementProblem('Vacancies today', 'Ten new MR openings are live in Bengaluru today.'), null)
assert.equal(announcementProblem('  Vacancies today  ', '  Ten new MR openings are live.  '), null, 'surrounding spaces are fine')
assert.match(announcementProblem('A'.repeat(81), 'x'.repeat(20)), /under 80/i)
assert.match(announcementProblem('Vacancies today', 'x'.repeat(601)), /under 600/i)
assert.equal(announcementProblem('A'.repeat(80), 'x'.repeat(600)), null, 'exactly at the limits is accepted')

// The signed body is exactly what the phone shows.
assert.equal(
  announcementBody('  Ten new openings  ', 'Mr. Divakar Reddy, Founder, MedRep Connect Pro'),
  'Ten new openings\n\nMr. Divakar Reddy, Founder, MedRep Connect Pro',
)

// ---- Which arrivals deserve a ring ----
const items = [
  { id: 'a', createdAt: 1000 },
  { id: 'b', createdAt: 3000 },
  { id: 'c', createdAt: 2000 },
  { id: 'd', createdAt: 500 },
]
// First check on a device: only sets the watermark, never rings for the backlog.
assert.deepEqual(notificationsToAlert(items, [], 0), [])
assert.equal(nextWatermark(0, items, []), 3000)
// Later: only genuinely new ones, newest first, capped.
assert.deepEqual(notificationsToAlert(items, ['a'], 1000).map((n) => n.id), ['b', 'c'])
assert.deepEqual(notificationsToAlert(items, [], 1500).map((n) => n.id), ['b', 'c'])
assert.deepEqual(notificationsToAlert(items, ['b', 'c'], 1000), [])
assert.deepEqual(notificationsToAlert(items, [], 1000, 1).map((n) => n.id), ['b'], 'never floods the phone')
// Ids this device has already listed never ring again, whatever the watermark is.
assert.deepEqual(notificationsToAlert(items, ['b', 'c'], 100).map((n) => n.id), ['a', 'd'],
  'a device that was away still hears about what it never listed')
assert.deepEqual(notificationsToAlert(items, ['a', 'b', 'c', 'd'], 100), [])
// The watermark never moves backwards and only advances past what was alerted.
assert.equal(nextWatermark(3000, items, []), 3000)
assert.equal(nextWatermark(1000, items, [{ createdAt: 3000 }]), 3000)
assert.equal(nextWatermark(5000, [{ createdAt: 6000 }], [{ createdAt: 6000 }]), 6000)
assert.equal(nextWatermark(0, [], []), 0)
// Sound is a user choice, and only when something actually arrived.
assert.equal(shouldChime(true, 2), true)
assert.equal(shouldChime(true, 0), false)
assert.equal(shouldChime(false, 3), false, 'the sound switch is respected')

console.log('push rules: availability states, announcement limits, watermark and sound passed')
