import assert from 'node:assert/strict'
import {
  ADMOB_APP_ID,
  ADMOB_BANNER_AD_UNIT_ID,
  ADMOB_REWARDED_AD_UNIT_ID,
  bannerAllowedOnTab,
  rewardedUnlockOffered,
  unlockButtonLabel,
} from '../src/data/adConfig.ts'
import { defaultPlayProductId, playPurchasablePlans } from '../src/data/playProducts.ts'
import { readFile } from 'node:fs/promises'

/**
 * Android ads + Play product mapping (src/data/adConfig.ts, playProducts.ts):
 *   - the owner's REAL AdMob app/banner/rewarded IDs (unit tests pin them so
 *     a stray edit can't silently swap production units);
 *   - banner on content screens only — never login/sign-up/password/payment
 *     (the Plans tab is the payment screen);
 *   - rewarded unlock offered only in the Android app, only to free users,
 *     only until that job's company is unlocked; subscribers never see it;
 *   - every catalog plan maps to its one-time Play "N-day pass".
 */
assert.equal(ADMOB_APP_ID, 'ca-app-pub-3694622521401615~5426441207', 'real MedRep Pro AdMob app ID (matches AndroidManifest.xml)')
assert.equal(ADMOB_BANNER_AD_UNIT_ID, 'ca-app-pub-3694622521401615/2527533866', 'real Banner home screen unit')
assert.equal(ADMOB_REWARDED_AD_UNIT_ID, 'ca-app-pub-3694622521401615/4112078274', 'real Rewarded_unlockfeature unit')

/**
 * app-ads.txt is what makes those units verifiable: AdMob crawls the developer
 * website on the Play listing (https://medrepconnect.in) and looks for this
 * file at the site root. A missing or stale publisher line silently downgrades
 * the app's ad serving, and the failure shows up in AdMob, not in the app — so
 * pin it against the app ID here instead of finding out from a report.
 */
const appAdsTxt = await readFile(new URL('../public/app-ads.txt', import.meta.url), 'utf8')
const publisherId = ADMOB_APP_ID.split('~')[0].replace('ca-app-pub-', '')
const records = appAdsTxt
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'))
assert.deepEqual(
  records,
  [`google.com, pub-${publisherId}, DIRECT, f08c47fec0942fa0`],
  'public/app-ads.txt must declare exactly the publisher that owns these ad units',
)

for (const tab of ['home', 'priority', 'ai', 'account']) {
  assert.equal(bannerAllowedOnTab(tab), true, `banner allowed on content screen: ${tab}`)
}
for (const tab of ['plans', 'login', 'signup', 'forgot', 'update-password', 'payment', '']) {
  assert.equal(bannerAllowedOnTab(tab), false, `no banner on: ${tab || '(login shell)'}`)
}

assert.equal(rewardedUnlockOffered({ isAndroidApp: true, subscribed: false, companyUnlocked: false }), true, 'free Android user sees the unlock video')
assert.equal(rewardedUnlockOffered({ isAndroidApp: true, subscribed: true, companyUnlocked: false }), false, 'subscribers never see rewarded videos')
assert.equal(rewardedUnlockOffered({ isAndroidApp: true, subscribed: false, companyUnlocked: true }), false, 'no second video once unlocked')
assert.equal(rewardedUnlockOffered({ isAndroidApp: false, subscribed: false, companyUnlocked: false }), false, 'website never shows rewarded videos')

/**
 * The unlock button's text must match what is actually happening. Reported from
 * the phone: tapping it showed "Checking your unlock…" while the ad was still
 * loading — and when there was no ad to load, it showed that for a minute with
 * nothing happening at all.
 */
assert.equal(unlockButtonLabel(null), '▶ Watch video to unlock company name', 'idle: offers the video')
assert.equal(unlockButtonLabel('loading'), '⏳ Loading video…', 'loading is not "checking"')
assert.match(unlockButtonLabel('watching'), /watch to the end/, 'watching tells the user the reward needs the whole video')
assert.equal(unlockButtonLabel('verifying'), '⏳ Checking your unlock…', 'only the server-confirmation stage checks')

assert.equal(defaultPlayProductId('p5'), 'medrep_pass_5d')
assert.equal(defaultPlayProductId('p365'), 'medrep_pass_365d')
assert.equal(defaultPlayProductId('nope'), undefined)
const plans = [
  { id: 'p5', playProductId: 'medrep_pass_5d' },
  { id: 'custom', playProductId: undefined },
]
assert.deepEqual(playPurchasablePlans(plans).map((p) => p.id), ['p5'], 'only mapped plans are Play-purchasable')

console.log('android ads: real units, content-only banner, free-only rewarded unlock, honest unlock-button stages, Play pass mapping, app-ads.txt — passed')
