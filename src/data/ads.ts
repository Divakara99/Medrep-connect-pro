import { isAndroidApp } from './platform'
import { ADMOB_BANNER_AD_UNIT_ID, ADMOB_REWARDED_AD_UNIT_ID, usingTestAdUnits } from './adConfig'

/**
 * AdMob wrapper (Android app only).
 *
 * The plugin is imported lazily so the website bundle never loads — let
 * alone initialises — any advertising SDK: on the web every function here is
 * a no-op. Ads follow the owner's rules:
 *   - adaptive banner on content screens for free AND subscribed users;
 *   - rewarded video only for free users, only to unlock one job's company
 *     name, and the unlock itself is granted exclusively by AdMob's
 *     server-side verification callback into our Edge Function — this file
 *     never marks anything unlocked itself, it only asks the app to poll.
 *   - UMP consent is requested (India distribution) before ads load.
 */

type AdMobPlugin = typeof import('@capacitor-community/admob').AdMob
type BannerSize = import('@capacitor-community/admob').BannerAdSize
type BannerPosition = import('@capacitor-community/admob').BannerAdPosition

let pluginPromise: Promise<AdMobPlugin | null> | null = null
let initialised = false
let bannerVisible = false

async function loadPlugin(): Promise<AdMobPlugin | null> {
  if (!isAndroidApp()) return null
  pluginPromise ??= import('@capacitor-community/admob')
    .then((module) => module.AdMob)
    .catch(() => null)
  return pluginPromise
}

/** UMP consent, then SDK init. Safe to call repeatedly; runs once. */
export async function initAds(): Promise<void> {
  const AdMob = await loadPlugin()
  if (!AdMob || initialised) return
  initialised = true
  try {
    // AdMob UMP consent flow. In India this typically resolves to
    // NOT_REQUIRED / OBTAINED without a form; where a form exists it must be
    // completed before ads are requested.
    const consent = await AdMob.requestConsentInfo({ tagForUnderAgeOfConsent: false })
    if (consent.isConsentFormAvailable && consent.status === 'REQUIRED') {
      await AdMob.showConsentForm()
    }
  } catch {
    // Consent problems must never block the app; ads simply may not load.
  }
  try {
    await AdMob.initialize({ initializeForTesting: usingTestAdUnits() })
  } catch {
    // Ad load failures are non-fatal by design.
  }
}

export async function showBanner(margin = 0): Promise<void> {
  const AdMob = await loadPlugin()
  if (!AdMob) return
  await initAds()
  try {
    await AdMob.showBanner({
      adId: ADMOB_BANNER_AD_UNIT_ID,
      adSize: 'ADAPTIVE_BANNER' as BannerSize,
      position: 'BOTTOM_CENTER' as BannerPosition,
      // Bottom margin lifts the native banner above a screen's own fixed
      // bottom bar (Account's Save/Logout bar) instead of covering it.
      margin,
      isTesting: usingTestAdUnits(),
    })
    bannerVisible = true
  } catch {
    bannerVisible = false
  }
}

export async function hideBanner(): Promise<void> {
  if (!bannerVisible) return
  const AdMob = await loadPlugin()
  if (!AdMob) return
  bannerVisible = false
  try {
    await AdMob.hideBanner()
  } catch {
    // Already gone.
  }
}

export type RewardedOutcome =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Play one rewarded video for `jobId` on behalf of `userId`.
 *
 * The SSV payload (user_id = Supabase user id, custom_data = job id) is what
 * Google signs and posts to the admob-reward-verification Edge Function;
 * resolving `ok` here only means the video completed on-device. The caller
 * must poll the server (see companyUnlocks.ts) — never unlock locally.
 */
export async function showRewardedUnlock(userId: string, jobId: string): Promise<RewardedOutcome> {
  const AdMob = await loadPlugin()
  if (!AdMob) return { ok: false, error: 'Video ads are available in the Android app only.' }
  await initAds()
  try {
    await AdMob.prepareRewardVideoAd({
      adId: ADMOB_REWARDED_AD_UNIT_ID,
      isTesting: usingTestAdUnits(),
      ssv: { userId, customData: jobId },
    })
    await AdMob.showRewardVideoAd()
    return { ok: true }
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error && cause.message
        ? cause.message
        : 'The video could not be played. Check your connection and try again.',
    }
  }
}
