/**
 * AdMob configuration.
 *
 * The AdMob APP ID is the owner's real MedRep Pro ID (`ADMOB_APP_ID` below,
 * also in android/app/src/main/AndroidManifest.xml — keep both in sync).
 * The two AD UNIT IDs are still Google's public sample IDs
 * (https://developers.google.com/admob/android/test-ads#sample_ad_units):
 * they only ever serve test ads, on any device, and can never earn revenue
 * or trigger an invalid-traffic ban. When the owner creates the real banner
 * and rewarded units in the AdMob console, swap those two values here and
 * the ADMOB_REWARDED_AD_UNIT_ID Supabase secret at the same time (the Edge
 * Function refuses callbacks for any other unit) — see ANDROID.md.
 *
 * Pure data + pure helpers only: this module is unit-tested on the web
 * (scripts/test-android-ads.mjs) and imported by the native ads wrapper.
 */
export const ADMOB_APP_ID = 'ca-app-pub-3694622521401615~5426441207'
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
