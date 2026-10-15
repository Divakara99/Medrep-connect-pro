/**
 * AdMob configuration — Google TEST IDs until the owner supplies real ones.
 *
 * These are Google's public sample IDs
 * (https://developers.google.com/admob/android/test-ads#sample_ad_units):
 * they only ever serve test ads, on any device, and can never earn revenue
 * or trigger an invalid-traffic ban. Swap the three `ca-app-pub-…` values
 * (and the app ID in android/app/src/main/AndroidManifest.xml) for the real
 * MedRep Pro units before submitting to Play — see ANDROID.md. The Edge
 * Function checks the rewarded unit against its own ADMOB_REWARDED_AD_UNIT_ID
 * secret, which must be swapped at the same time.
 *
 * Pure data + pure helpers only: this module is unit-tested on the web
 * (scripts/test-android-ads.mjs) and imported by the native ads wrapper.
 */
export const ADMOB_TEST_APP_ID = 'ca-app-pub-3940256099942544~3347511713'
export const ADMOB_BANNER_AD_UNIT_ID = 'ca-app-pub-3940256099942544/6300978111'
export const ADMOB_REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917'

/** True while any configured unit is still one of Google's test IDs. */
export function usingTestAdUnits(
  bannerId: string = ADMOB_BANNER_AD_UNIT_ID,
  rewardedId: string = ADMOB_REWARDED_AD_UNIT_ID,
): boolean {
  return bannerId.includes('3940256099942544') || rewardedId.includes('3940256099942544')
}

/**
 * Should a banner be requested on this tab?
 *
 * Content screens only — never on login / sign-up / password / payment
 * screens. `plans` is the payment screen, so it is excluded even though it
 * is a tab; the login family never reaches this helper at all.
 */
export function bannerAllowedOnTab(tab: string): boolean {
  return tab === 'home' || tab === 'priority' || tab === 'ai' || tab === 'account'
}

/**
 * Rewarded "unlock the company name" is offered only to free users, only in
 * the Android app, and only for a job whose company is not already unlocked.
 * Subscribers never see rewarded videos; a company unlocked once (by ad or
 * by subscription) never asks again.
 */
export function rewardedUnlockOffered(input: {
  isAndroidApp: boolean
  subscribed: boolean
  companyUnlocked: boolean
}): boolean {
  return input.isAndroidApp && !input.subscribed && !input.companyUnlocked
}
