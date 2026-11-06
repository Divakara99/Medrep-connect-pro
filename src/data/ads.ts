import { rewardedErrorMessage } from './storeMessages'
import { isAndroidApp } from './platform'
import { ADMOB_BANNER_AD_UNIT_ID, ADMOB_REWARDED_AD_UNIT_ID, type UnlockStage } from './adConfig'

/**
 * How long the rewarded ad may spend loading before the user is told it is not
 * coming.
 *
 * Loading is usually the slow part, so the app no longer starts it on tap: a
 * preload begins when the job is opened (see preloadRewardedUnlock), and the tap
 * only waits for what is left. When there is nothing to preload — no fill — the
 * wait is now 12 seconds rather than 20 before saying so.
 */
const REWARDED_LOAD_TIMEOUT_MS = 12_000

/**
 * How long a prepared ad gets to actually appear.
 *
 * `showRewardVideoAd()` does not settle until the ad is dismissed, and when the
 * ad never opens it does not settle at all — the caller then sat on its 3-minute
 * backstop and reported "The video did not start or finish in time". A prepared
 * ad opens within a second or two, so 20 s means "it is not coming".
 */
const REWARDED_SHOW_TIMEOUT_MS = 20_000

/** The plugin's "rewarded ad opened" event, by value so no SDK code is bundled. */
const REWARDED_SHOWED_EVENT = 'onRewardedVideoAdShowed'

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
let initPromise: Promise<void> | null = null
let bannerVisible = false
let bannerWanted = false

/**
 * Last failure from each ad type, kept for on-device diagnosis. Ads fail
 * silently by design — a missing banner or a video that never appears must not
 * interrupt the app — but "no ads" is then invisible, and the only way to tell
 * "our request never reached AdMob" from "AdMob had nothing to fill" is to
 * read this. Exposed through adsDiagnostics().
 */
let lastBannerError = ''
let lastRewardedError = ''
let lastInitError = ''
/** null = not attempted yet, false = the plugin module never loaded. */
let pluginLoaded: boolean | null = null

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

/** Resolve with `null` if the promise has not settled within `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: number | undefined
  return Promise.race([
    promise,
    new Promise<null>((resolve) => { timer = window.setTimeout(() => resolve(null), ms) }),
  ]).finally(() => { if (timer !== undefined) window.clearTimeout(timer) })
}

async function loadPlugin(): Promise<AdMobPlugin | null> {
  if (!isAndroidApp()) return null
  pluginPromise ??= import('@capacitor-community/admob')
    .then((module) => {
      pluginLoaded = true
      return module.AdMob
    })
    .catch((cause: unknown) => {
      pluginLoaded = false
      lastInitError = `plugin import failed: ${describe(cause)}`
      console.warn('[ads]', lastInitError)
      return null
    })
  return pluginPromise
}

/**
 * Resolve with the promise's value, or null if it takes too long.
 *
 * AdMob's initialisation steps talk to Google's servers. If one of them never
 * answers, every caller behind it waits forever: ads requested, nothing shown,
 * and — crucially — no error recorded, because a hang is not an exception. That
 * is exactly what the on-device diagnostics showed (banner wanted: true,
 * banner visible: false, last banner error: empty).
 */
async function settleWithin<T>(promise: Promise<T>, ms: number, what: string): Promise<T | null> {
  let timer: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = window.setTimeout(() => {
          // Silence was the problem: a step that never answers looked exactly
          // like a step that succeeded.
          lastInitError = `${what} did not answer within ${ms / 1000}s`
          console.warn('[ads]', lastInitError)
          resolve(null)
        }, ms)
      }),
    ])
  } catch (cause) {
    lastInitError = `${what}: ${describe(cause)}`
    console.warn('[ads]', lastInitError)
    return null
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

/** UMP consent, then SDK init. Safe to call repeatedly; runs once. */
export function initAds(): Promise<void> {
  // One shared promise, not a boolean: callers used to see "already started"
  // and run straight into showBanner() while initialize() was still in flight,
  // which the SDK answers with a failure we swallow.
  initPromise ??= initialiseAds()
  return initPromise
}

async function initialiseAds(): Promise<void> {
  const AdMob = await loadPlugin()
  if (!AdMob) return

  // SDK first (local, quick), consent second. The old order ran UMP first, so a
  // consent call that never answered stopped the SDK from ever starting — and
  // nothing was requested from AdMob.
  await settleWithin(AdMob.initialize({ initializeForTesting: false }), 10_000, 'initialize')

  const consent = await settleWithin(
    AdMob.requestConsentInfo({ tagForUnderAgeOfConsent: false }),
    10_000,
    'requestConsentInfo',
  )
  if (consent && consent.isConsentFormAvailable && consent.status === 'REQUIRED') {
    await settleWithin(AdMob.showConsentForm(), 60_000, 'showConsentForm')
  }
}

async function showBannerOnce(margin: number): Promise<boolean> {
  const AdMob = await loadPlugin()
  if (!AdMob) {
    // Previously silent: the button reported "wanted" forever with no error.
    lastBannerError = pluginLoaded === false
      ? 'AdMob plugin unavailable in this build'
      : 'Ads are available in the Android app only'
    return false
  }
  await initAds()
  try {
    const shown = await settleWithin(
      AdMob.showBanner({
        adId: ADMOB_BANNER_AD_UNIT_ID,
        adSize: 'ADAPTIVE_BANNER' as BannerSize,
        position: 'BOTTOM_CENTER' as BannerPosition,
        // Bottom margin lifts the native banner above a screen's own fixed
        // bottom bar (Account's Save/Logout bar) instead of covering it.
        margin,
        isTesting: false,
      }),
      15_000,
      'showBanner',
    )
    if (shown === null) {
      lastBannerError = lastInitError || 'showBanner did not answer within 15s'
      return false
    }
    bannerVisible = true
    lastBannerError = ''
    return true
  } catch (cause) {
    bannerVisible = false
    lastBannerError = describe(cause)
    console.warn('[ads] banner failed:', lastBannerError)
    return false
  }
}

/**
 * Show the adaptive banner, retrying a few times while the screen still wants
 * it.
 *
 * A brand-new app often has no banner inventory for the first hours — AdMob
 * answers the first requests with no-fill — and a single failed request used to
 * mean no banner until the next screen change. Three attempts over ~90 seconds
 * costs nothing and is the difference between "ads are broken" and an ad
 * appearing a minute later.
 */
export async function showBanner(margin = 0): Promise<void> {
  bannerWanted = true
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!bannerWanted) return
    if (await showBannerOnce(margin)) return
    if (attempt < 2) {
      await new Promise((resolve) => window.setTimeout(resolve, 15_000 * (attempt + 1)))
    }
  }
}

export async function hideBanner(): Promise<void> {
  bannerWanted = false
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

/**
 * One banner request, no retries, for the diagnostics card.
 *
 * showBanner() retries for up to 90 seconds, which is right for a user waiting
 * for an ad but wrong for a test: the card sat on "Requesting…" and showed
 * nothing. This performs a single bounded attempt and reports what happened.
 */
export async function probeBanner(): Promise<ReturnType<typeof adsDiagnostics>> {
  bannerWanted = true
  const shown = await showBannerOnce(0)
  if (!shown && !lastBannerError) {
    lastBannerError = 'banner request finished without a banner and without an error'
  }
  return adsDiagnostics()
}

/**
 * Why the last ad request failed, for on-device checks. Empty strings mean the
 * request has not failed (or has not been made yet).
 *
 * Reachable from the WebView console inside the app:
 *   await window.__medrepAds?.()
 */
export function adsDiagnostics() {
  return {
    pluginLoaded,
    bannerVisible,
    bannerWanted,
    lastInitError,
    lastBannerError,
    lastRewardedError,
  }
}

/**
 * A rewarded ad prepared ahead of the tap, for one user + one job.
 *
 * AdMob ties the SSV payload to the request, so the ad can only be reused for
 * the same job. `ok` settles when the plugin has finished loading (or failed):
 * a tap then plays immediately instead of sitting on "Loading video…".
 */
let preloaded: { userId: string; jobId: string; ok: Promise<boolean> } | null = null

/** Start loading the rewarded video for a job the user just opened. */
export function preloadRewardedUnlock(userId: string, jobId: string): void {
  if (!isAndroidApp()) return
  if (preloaded?.userId === userId && preloaded.jobId === jobId) return
  const entry = {
    userId,
    jobId,
    ok: (async () => {
      const AdMob = await loadPlugin()
      if (!AdMob) return false
      await initAds()
      try {
        // Bounded: an unanswered prepare used to leave `ok` pending forever, and
        // every later tap awaited it until the caller's 3-minute backstop fired
        // with "The video did not start or finish in time".
        const loaded = await within(
          AdMob.prepareRewardVideoAd({
            adId: ADMOB_REWARDED_AD_UNIT_ID,
            isTesting: false,
            ssv: { userId, customData: jobId },
          }),
          REWARDED_LOAD_TIMEOUT_MS,
        )
        if (loaded === null) {
          lastRewardedError = 'preload did not answer in time'
          console.warn('[ads]', lastRewardedError)
          return false
        }
        return true
      } catch (cause) {
        lastRewardedError = describe(cause)
        console.warn('[ads] rewarded preload failed:', lastRewardedError)
        return false
      }
    })(),
  }
  preloaded = entry
  // A newer preload must win: discard the entry if another job was opened.
  void entry.ok.then(() => {
    if (preloaded === entry && !entry.ok) preloaded = null
  })
}

/**
 * Play the ad that is already prepared.
 *
 * Two things are watched: whether the ad actually opened (the plugin's Shown
 * event) and how long we are willing to wait for it. Only one of them can tell
 * "the video never started" apart from "the user is watching a 30-second video".
 */
async function playPreparedReward(AdMob: AdMobPlugin): Promise<RewardedOutcome> {
  const on = AdMob.addListener as unknown as (
    eventName: string,
    listenerFunc: () => void,
  ) => Promise<{ remove: () => Promise<void> } | void>

  let opened = false
  let handle: { remove: () => Promise<void> } | void = undefined
  try {
    handle = await on(REWARDED_SHOWED_EVENT, () => { opened = true })
  } catch {
    // Diagnostics only: without the listener the timeout still bounds the wait.
  }

  try {
    const dismissed = AdMob.showRewardVideoAd()
    const verdict = await Promise.race([
      dismissed.then(() => 'dismissed' as const),
      new Promise<'stalled'>((resolve) => {
        window.setTimeout(() => resolve('stalled'), REWARDED_SHOW_TIMEOUT_MS)
      }),
    ])
    if (verdict === 'stalled' && !opened) {
      lastRewardedError = 'rewarded ad never opened'
      console.warn('[ads]', lastRewardedError)
      return { ok: false, error: 'The video did not open. Please check your connection and try again.' }
    }
    // It opened: let the viewer finish it. Resolves on dismissal either way;
    // completion is confirmed by AdMob SSV, never here.
    await dismissed
    return { ok: true }
  } catch (cause) {
    lastRewardedError = describe(cause)
    console.warn('[ads] rewarded show failed:', lastRewardedError)
    return { ok: false, error: rewardedErrorMessage(cause).message }
  } finally {
    void handle?.remove?.()
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
export async function showRewardedUnlock(
  userId: string,
  jobId: string,
  onStage?: (stage: UnlockStage) => void,
): Promise<RewardedOutcome> {
  const AdMob = await loadPlugin()
  if (!AdMob) return { ok: false, error: 'Video ads are available in the Android app only.' }
  await initAds()

  onStage?.('loading')

  // Play the ad that was prepared when this job was opened, when it is ready.
  const cached = preloaded && preloaded.userId === userId && preloaded.jobId === jobId ? preloaded : null
  // Never wait on an unsettled preload for the whole flow: give it a few
  // seconds, then load the ad the normal way.
  if (cached && (await within(cached.ok, 4_000)) === true) {
    preloaded = null
    onStage?.('watching')
    const played = await playPreparedReward(AdMob)
    if (played.ok) onStage?.('verifying')
    return played
  }
  preloaded = null

  let loadTimer: number | undefined
  try {
    await Promise.race([
      AdMob.prepareRewardVideoAd({
        adId: ADMOB_REWARDED_AD_UNIT_ID,
        isTesting: false,
        ssv: { userId, customData: jobId },
      }),
      new Promise<never>((_, reject) => {
        loadTimer = window.setTimeout(() => reject(new Error('REWARDED_LOAD_TIMEOUT')), REWARDED_LOAD_TIMEOUT_MS)
      }),
    ])
  } catch (cause) {
    lastRewardedError = describe(cause)
    console.warn('[ads] rewarded failed:', lastRewardedError)
    if (cause instanceof Error && cause.message === 'REWARDED_LOAD_TIMEOUT') {
      return { ok: false, error: 'The video is taking too long to load. Please try again in a moment.' }
    }
    // AdMob's "no fill" until the app is reviewed is not a connection problem;
    // storeMessages.ts words it so the user knows the unlock is still free.
    return { ok: false, error: rewardedErrorMessage(cause).message }
  } finally {
    if (loadTimer !== undefined) window.clearTimeout(loadTimer)
  }

  onStage?.('watching')
  const played = await playPreparedReward(AdMob)
  if (played.ok) onStage?.('verifying')
  return played
}
