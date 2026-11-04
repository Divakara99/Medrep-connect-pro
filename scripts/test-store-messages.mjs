import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * Store failure messages (src/data/storeMessages.ts — the shipping source).
 *
 * While the one-time passes and the AdMob app are in review, the plugins return
 * raw codes. The app must never show "ITEM_UNAVAILABLE" to a job seeker, and it
 * must not tell someone their connection is down when the product simply is not
 * on sale yet.
 */
const source = await readFile(new URL('../src/data/storeMessages.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: 'storeMessages.ts',
}).outputText
const file = join(process.env.TMPDIR || '/tmp', `mrc-storemessages-${process.pid}.mjs`)
await writeFile(file, javascript)
const { billingErrorMessage, rewardedErrorMessage } = await import(pathToFileURL(file).href)

const noCodes = (message) => {
  assert.ok(!/ITEM_|BILLING_|DEVELOPER_ERROR|SERVICE_DISCONNECTED|no fill/i.test(message), `raw code leaked: ${message}`)
  assert.ok(message.length > 20, 'message too terse to help')
  assert.ok(/[.!]$/.test(message), 'message should read as a sentence')
}

// --- billing ----------------------------------------------------------------
{
  const review = billingErrorMessage(new Error('ITEM_UNAVAILABLE'))
  assert.match(review.message, /reviewing|not on sale/i, 'products in review must say so')
  assert.equal(review.retryable, false, 'retrying immediately cannot help while in review')
  noCodes(review.message)

  assert.match(billingErrorMessage('BILLING_UNAVAILABLE').message, /Play Store app|not available/i)
  assert.match(billingErrorMessage('SERVICE_DISCONNECTED').message, /connection/i)
  assert.match(billingErrorMessage(new Error('User canceled the purchase')).message, /cancelled/i)
  assert.match(billingErrorMessage('ITEM_ALREADY_OWNED').message, /already own/i)
  assert.match(billingErrorMessage('DEVELOPER_ERROR').message, /rejected|support/i)

  // Unknown text still produces something usable, never the raw string.
  const unknown = billingErrorMessage(new Error('E_SOMETHING_WEIRD happened'))
  assert.doesNotMatch(unknown.message, /E_SOMETHING_WEIRD/)
  noCodes(unknown.message)
  assert.match(billingErrorMessage(undefined).message, /try again/i)
}

// --- rewarded video ---------------------------------------------------------
{
  const unfilled = rewardedErrorMessage(new Error('load failed: no fill'))
  assert.match(unfilled.message, /no video is available/i, 'no fill is not a crash')
  assert.match(unfilled.message, /free/i, 'the company name stays free — say so')
  noCodes(unfilled.message)

  assert.match(rewardedErrorMessage('network error').message, /connection|internet/i)
  assert.match(rewardedErrorMessage('Video ads are available in the Android app only').message, /Android app/i)
  const unknown = rewardedErrorMessage(new Error('E_AD_UNKNOWN'))
  assert.doesNotMatch(unknown.message, /E_AD_UNKNOWN/)
  assert.match(rewardedErrorMessage(null).message, /try again/i)
}

console.log('store messages: review, no-fill, billing-unavailable and cancellation all read as sentences')
