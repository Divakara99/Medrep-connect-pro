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

/**
 * Where the "watch a video" flow has got to. The button used to show
 * "Checking your unlock…" from the instant it was tapped, which was wrong twice
 * over: nothing is being checked while the ad is still loading, and when there
 * is no inventory the ad never loads at all, so the label sat there as if
 * something were happening.
 *
 *   loading   — preparing the rewarded ad (can take a few seconds, can fail)
 *   watching  — the video is on screen; the reward is only granted to
 *               completion, and the unlock itself still comes from AdMob SSV
 *   verifying — video finished, waiting for the server to confirm the unlock
 */
export type UnlockStage = 'loading' | 'watching' | 'verifying'

export function unlockButtonLabel(stage: UnlockStage | null | undefined): string {
  switch (stage) {
    case 'loading':
      return '⏳ Loading video…'
    case 'watching':
      return '▶ Playing video — watch to the end to unlock'
    case 'verifying':
      return '⏳ Checking your unlock…'
    default:
      return '▶ Watch video to unlock company name'
  }
}
