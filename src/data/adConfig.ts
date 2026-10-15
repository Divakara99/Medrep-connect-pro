/**
 * AdMob configuration — the owner's REAL MedRep Pro units.
 *
 * `ADMOB_APP_ID` also lives in android/app/src/main/AndroidManifest.xml
 * (keep both in sync). The banner and rewarded unit IDs below must match
 * the units in the AdMob console, and the Supabase secret
 * ADMOB_REWARDED_AD_UNIT_ID must equal ADMOB_REWARDED_AD_UNIT_ID here —
 * the admob-reward-verification Edge Function refuses SSV callbacks for
 * any other unit. No test/sample ad IDs exist anywhere in the app;
 * on-device ad testing uses AdMob test devices (console setting), never
 * test units in a shipped build.
 *
 * Pure data + pure helpers only: this module is unit-tested on the web
 * (scripts/test-android-ads.mjs) and imported by the native ads wrapper.
 */
export const ADMOB_APP_ID = 'ca-app-pub-3694622521401615~5426441207'
export const ADMOB_BANNER_AD_UNIT_ID = 'ca-app-pub-3694622521401615/2527533866'
export const ADMOB_REWARDED_AD_UNIT_ID = 'ca-app-pub-3694622521401615/4112078274'

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
