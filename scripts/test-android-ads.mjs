import assert from 'node:assert/strict'
import {
  ADMOB_BANNER_AD_UNIT_ID,
  ADMOB_REWARDED_AD_UNIT_ID,
  bannerAllowedOnTab,
  rewardedUnlockOffered,
  usingTestAdUnits,
} from '../src/data/adConfig.ts'
import { defaultPlayProductId, playPurchasablePlans } from '../src/data/playProducts.ts'

/**
 * Android ads + Play product mapping (src/data/adConfig.ts, playProducts.ts):
 *   - Google TEST ad units until the owner supplies real ones;
 *   - banner on content screens only — never login/sign-up/password/payment
 *     (the Plans tab is the payment screen);
 *   - rewarded unlock offered only in the Android app, only to free users,
 *     only until that job's company is unlocked; subscribers never see it;
 *   - every catalog plan maps to its one-time Play "N-day pass".
 */
assert.match(ADMOB_BANNER_AD_UNIT_ID, /^ca-app-pub-3940256099942544\//, 'banner still a Google test unit')
assert.match(ADMOB_REWARDED_AD_UNIT_ID, /^ca-app-pub-3940256099942544\//, 'rewarded still a Google test unit')
assert.equal(usingTestAdUnits(), true, 'test units detected')
assert.equal(usingTestAdUnits('ca-app-pub-1234567890123456/1', 'ca-app-pub-1234567890123456/2'), false, 'real units detected')

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

assert.equal(defaultPlayProductId('p5'), 'medrep_pass_5d')
assert.equal(defaultPlayProductId('p365'), 'medrep_pass_365d')
assert.equal(defaultPlayProductId('nope'), undefined)
const plans = [
  { id: 'p5', playProductId: 'medrep_pass_5d' },
  { id: 'custom', playProductId: undefined },
]
assert.deepEqual(playPurchasablePlans(plans).map((p) => p.id), ['p5'], 'only mapped plans are Play-purchasable')

console.log('android ads: test units, content-only banner, free-only rewarded unlock, Play pass mapping — passed')
