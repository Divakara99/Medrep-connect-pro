import { Capacitor } from '@capacitor/core'
import { rewardedErrorMessage } from './storeMessages'
import { isAndroidApp } from './platform'
import { ADMOB_APP_ID, ADMOB_BANNER_AD_UNIT_ID, ADMOB_REWARDED_AD_UNIT_ID, type UnlockStage } from './adConfig'

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

/**
 * Nothing here may wait longer than this. Initialisation gets 12 s and the
 * banner request 15 s, so a probe that is still running after 30 s is stuck, and
 * saying so beats spinning.
 */
const PROBE_DEADLINE_MS = 30_000

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
/**
 * Banner requests and whether one is in flight right now.
 *
 * An empty `lastBannerError` was ambiguous: it meant either "never asked" or
 * "asked a second ago and still waiting", and the card showed the same thing for
 * both. With the counter and the flag the difference is visible.
 */
let bannerAttempts = 0
let bannerPending = false
/** Margin the currently shown banner was requested with, or null. */
let bannerMargin: number | null = null
/** The running retry loop, so repeat calls join it instead of stacking. */
let bannerLoop: Promise<void> | null = null
/** null = not attempted yet, false = the plugin module never loaded. */
let pluginLoaded: boolean | null = null

/**
 * Timestamped trail of what the ad code actually did.
 *
 * Two rounds of diagnosis ended in states that contradicted themselves on
 * screen — "plugin loaded: true" next to an initialisation that never started —
 * so the steps are recorded as they happen and shown on the card. A timeline
 * cannot contradict itself.
 */
const trace: string[] = []
function mark(step: string) {
  const at = new Date().toISOString().slice(11, 19)
  trace.push(`${at} ${step}`)
  if (trace.length > 60) trace.shift()
}

/**
 * Rejections with no handler are invisible: nothing on screen, nothing in the
 * card, and the code that produced them looks like it simply stopped. They are
 * recorded in the trace instead.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    mark(`UNHANDLED ${describe(event.reason)}`)
  })
}

function describe(cause: unknown): string {
  if (cause instanceof Error) {
    // AdMob errors carry a numeric code and the message is often just the
    // generic one; "No fill" is code 3 and means something very different from
    // a network failure, so the code is part of the diagnosis.
    const code = (cause as Error & { code?: unknown }).code
    return code === undefined || code === null
      ? cause.message
      : `${cause.message} (code ${String(code)})`
  }
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

/**
 * The Capacitor plugin object is a Proxy: EVERY property access returns a
 * method, including `then`. Returning it from an async function therefore makes
 * the promise machinery treat it as a thenable, call `then(resolve, reject)`, and
 * reject with:
 *
 *     "AdMob.then()" is not implemented on android (code UNIMPLEMENTED)
 *
 * That single line — caught by the unhandled-rejection hook — is why no ad ever
 * loaded: every caller awaited a promise that had been poisoned by its own
 * resolved value. The plugin is now kept in a module variable and the helpers
 * resolve with a boolean, so nothing ever resolves *with* the Proxy.
 */
let pluginInstance: AdMobPlugin | null = null

async function ensurePlugin(): Promise<boolean> {
  if (!isAndroidApp()) {
    mark('plugin: not the Android app')
    return false
  }
  if (pluginInstance) return true
  try {
    // Bounded: an import that never settles must become an error the card can
    // show, never a silent wait.
    const module = await within(import('@capacitor-community/admob'), 10_000)
    if (!module) {
      pluginLoaded = false
      lastInitError = 'plugin import did not settle in 10s'
      mark('plugin: import did not settle in 10s')
      return false
    }
    pluginInstance = module.AdMob
    pluginLoaded = true
    mark('plugin: imported')
    return true
  } catch (cause) {
    pluginLoaded = false
    lastInitError = `plugin import failed: ${describe(cause)}`
    mark(`plugin: failed ${describe(cause)}`)
    return false
  }
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
async function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
  // Where the failure belongs. A banner timeout used to be written into
  // `lastInitError`, so the card blamed initialisation for a banner that never
  // answered.
  sink: 'init' | 'banner' | 'note' = 'init',
): Promise<T | null> {
  const record = (message: string) => {
    if (sink === 'banner') lastBannerError = message
    else if (sink === 'init') lastInitError = message
    // 'note' only reaches the trace: UMP with no message configured in the
    // AdMob console answers "Publisher misconfiguration", which is a console
    // setting, not a broken app — and it must not look like one.
    mark(message)
    console.warn('[ads]', message)
  }
  let timer: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = window.setTimeout(() => {
          // Silence was the problem: a step that never answers looked exactly
          // like a step that succeeded.
          record(`${what} did not answer within ${ms / 1000}s`)
          resolve(null)
        }, ms)
      }),
    ])
  } catch (cause) {
    record(`${what}: ${describe(cause)}`)
    return null
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

/**
 * How far initialisation has got.
 *
 * The card showed "Requesting…" with an empty error for over a minute: a step
 * was still pending, and nothing said which. Naming the stage makes that visible
 * without a USB cable.
 */
export type InitStage = 'idle' | 'sdk' | 'consent' | 'consent-form' | 'ready' | 'no-plugin'
let initStage: InitStage = 'idle'

/** UMP consent, then SDK init. Safe to call repeatedly; runs once. */
export function initAds(): Promise<void> {
  // One shared promise, not a boolean: callers used to see "already started"
  // and run straight into showBanner() while initialize() was still in flight,
  // which the SDK answers with a failure we swallow.
  initPromise ??= initialiseAds().catch((cause: unknown) => {
    lastInitError = `initialiseAds threw: ${describe(cause)}`
    mark(`init: threw ${lastInitError}`)
  })
  return initPromise
}

async function initialiseAds(): Promise<void> {
  mark('init: start')
  const ready = await ensurePlugin()
  mark(`init: plugin ${ready ? 'ready' : 'missing'}`)
  const AdMob = pluginInstance
  if (!ready || !AdMob) {
    initStage = 'no-plugin'
    return
  }

  // SDK first (local, quick), consent second. The old order ran UMP first, so a
  // consent call that never answered stopped the SDK from ever starting — and
  // nothing was requested from AdMob.
  initStage = 'sdk'
  mark('init: initialize()')
  await settleWithin(AdMob.initialize({ initializeForTesting: false }), 10_000, 'initialize')
  mark('init: initialize() settled')

  initStage = 'consent'
  mark('init: requestConsentInfo()')
  const consent = await settleWithin(
    AdMob.requestConsentInfo({ tagForUnderAgeOfConsent: false }),
    6_000,
    'requestConsentInfo',
    'note',
  )
  if (consent && consent.isConsentFormAvailable && consent.status === 'REQUIRED') {
    initStage = 'consent-form'
    // Deliberately not awaited. The consent form is a native overlay; blocking
    // the ad pipeline on it — 60 s, and a form that never closes blocks it for
    // good — is what left the diagnostics button on "Requesting…" indefinitely.
    void settleWithin(AdMob.showConsentForm(), 120_000, 'showConsentForm')
  }
  initStage = 'ready'
  mark('init: ready')
}

async function showBannerOnce(margin: number): Promise<boolean> {
  mark('banner: start')
  const ready = await ensurePlugin()
  mark(`banner: plugin ${ready ? 'ready' : 'missing'}`)
  const AdMob = pluginInstance
  if (!ready || !AdMob) {
    // Previously silent: the button reported "wanted" forever with no error.
    lastBannerError = pluginLoaded === false
      ? 'AdMob plugin unavailable in this build'
      : 'Ads are available in the Android app only'
    return false
  }
  // Never let a stuck initialisation swallow the request itself.
  await within(initAds(), 12_000)
  mark(`banner: init wait done (stage ${initStage})`)
  bannerAttempts += 1
  bannerPending = true
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
      'banner',
    )
    if (shown === null) {
      if (!lastBannerError) lastBannerError = 'showBanner did not answer within 15s'
      return false
    }
    mark('banner: shown')
    bannerVisible = true
    lastBannerError = ''
    return true
  } catch (cause) {
    bannerVisible = false
    lastBannerError = describe(cause)
    mark(`banner: threw ${lastBannerError}`)
    console.warn('[ads] banner failed:', lastBannerError)
    return false
  } finally {
    bannerPending = false
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
  // Already on screen with the same margin: nothing to do. Screens remount
  // freely, and each remount used to issue a fresh native request — twelve of
  // them in one minute on the tablet, all queued behind a banner that was
  // already visible.
  if (bannerVisible && bannerMargin === margin) return
  if (bannerLoop) return bannerLoop
  // Different margin means a different position: clear the old one first, or
  // the SDK is asked to move a banner that is already attached.
  if (bannerVisible && pluginInstance) {
    mark('banner: repositioning')
    bannerVisible = false
    bannerMargin = null
    try {
      await pluginInstance.removeBanner()
    } catch {
      // Nothing attached; carry on.
    }
  }
  bannerLoop = runBannerLoop(margin).finally(() => { bannerLoop = null })
  return bannerLoop
}

async function runBannerLoop(margin: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!bannerWanted) return
    if (await showBannerOnce(margin)) {
      bannerMargin = margin
      return
    }
    if (attempt < 2) {
      await new Promise((resolve) => window.setTimeout(resolve, 15_000 * (attempt + 1)))
    }
  }
}

export async function hideBanner(): Promise<void> {
  bannerWanted = false
  if (!bannerVisible) return
  bannerVisible = false
  bannerMargin = null
  if (!(await ensurePlugin()) || !pluginInstance) return
  const AdMob = pluginInstance
  // removeBanner, not hideBanner: hiding keeps the native view alive, and a
  // later show on top of a hidden-but-present banner is exactly the state where
  // the native call stopped answering (15 s timeouts on the tablet).
  try {
    await AdMob.removeBanner()
    mark('banner: removed')
  } catch {
    try {
      await AdMob.hideBanner()
      mark('banner: hidden')
    } catch {
      mark('banner: already gone')
    }
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
  // A deadline around the WHOLE probe, not just its parts. Each step is bounded
  // on its own, but a step that hangs before its timer is armed (the SDK call
  // itself, for instance) would still leave the button on "Requesting…"
  // forever — which is exactly what the tablet showed.
  const shown = await within(showBannerOnce(0), PROBE_DEADLINE_MS).catch((cause: unknown) => {
    lastBannerError = `banner request threw: ${describe(cause)}`
    mark(`probe: threw ${lastBannerError}`)
    return false
  })
  if (shown === null) {
    lastBannerError =
      `no answer from the ad SDK within ${PROBE_DEADLINE_MS / 1000}s` +
      ` (init stage: ${initStage}${bannerPending ? ', request still in flight' : ''})`
    console.warn('[ads]', lastBannerError)
  } else if (!shown && !lastBannerError) {
    lastBannerError = 'banner request finished without a banner and without an error'
  }
  return adsDiagnostics()
}

/**
 * Can this device reach Google's ad servers at all?
 *
 * "No fill" and "the request was blocked before it left the phone" look
 * identical from inside the app: both end with no ad. They need opposite
 * responses, so this asks the two domains every mobile ad request goes through.
 *
 * no-cors is deliberate — an opaque response still proves DNS and TCP worked,
 * and a rejected fetch means the request never got there. Reading the body would
 * be blocked by CORS and prove nothing extra.
 */
export type NetworkProbe = { url: string; reachable: boolean; ms: number; detail: string }

const AD_NETWORK_PROBES = [
  'https://googleads.g.doubleclick.net/pagead/id',
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
]

export async function probeAdNetwork(): Promise<NetworkProbe[]> {
  const results: NetworkProbe[] = []
  for (const url of AD_NETWORK_PROBES) {
    const started = Date.now()
    const controller = typeof AbortController === 'undefined' ? null : new AbortController()
    let timer: number | undefined
    try {
      const attempt = fetch(url, {
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller?.signal,
      })
      const settled = await Promise.race([
        attempt.then(() => 'reachable' as const).catch((cause: unknown) => describe(cause)),
        new Promise<'timeout'>((resolve) => {
          timer = window.setTimeout(() => {
            controller?.abort()
            resolve('timeout')
          }, 8_000)
        }),
      ])
      results.push({
        url,
        reachable: settled === 'reachable',
        ms: Date.now() - started,
        detail: settled === 'reachable' ? 'ok' : settled === 'timeout' ? 'no answer in 8s' : settled,
      })
    } finally {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }
  return results
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
    // Is the native side registered? A JS module can import fine while the
    // native plugin is absent, and then every call hangs with no error.
    pluginAvailable: pluginAvailable(),
    trace: [...trace],
    appId: ADMOB_APP_ID,
    bannerUnit: ADMOB_BANNER_AD_UNIT_ID,
    rewardedUnit: ADMOB_REWARDED_AD_UNIT_ID,
    pluginLoaded,
    bannerVisible,
    bannerWanted,
    bannerAttempts,
    bannerPending,
    initStage,
    lastInitError,
    lastBannerError,
    lastRewardedError,
  }
}

/** Whether the native AdMob plugin is registered in this build. */
function pluginAvailable(): boolean | null {
  try {
    return Capacitor.isPluginAvailable('AdMob')
  } catch {
    return null
  }
}

/**
 * Ask the SDK one question and report the answer, bypassing all of our own
 * wrappers. If the import or the native call hangs here, the fault is in the
 * bridge, not in the ad flow.
 */
export async function pingAdSdk(): Promise<string> {
  mark('ping: start')
  const imported = await within(import('@capacitor-community/admob'), 8_000)
  if (!imported) {
    mark('ping: import hung')
    return 'plugin import did not finish in 8s'
  }
  mark('ping: imported')
  const plugin = imported.AdMob
  if (!plugin) return 'plugin module has no AdMob export'
  const initialized = await within(plugin.initialize({ initializeForTesting: false }), 8_000)
  if (initialized === null) {
    mark('ping: initialize hung')
    return 'initialize() did not answer in 8s'
  }
  mark('ping: initialize resolved')
  return 'plugin imported, initialize() answered'
}

/** Everything the diagnostics card shows, as copyable text. */
export function adsDiagnosticsText(): string {
  const state = adsDiagnostics()
  return [
    `app id: ${state.appId}`,
    `banner unit: ${state.bannerUnit}`,
    `rewarded unit: ${state.rewardedUnit}`,
    `plugin loaded: ${String(state.pluginLoaded)}`,
    `banner wanted: ${String(state.bannerWanted)}`,
    `banner visible: ${String(state.bannerVisible)}`,
    `banner attempts: ${state.bannerAttempts}${state.bannerPending ? ' (one in flight)' : ''}`,
    `init stage: ${state.initStage}`,
    `plugin available: ${String(state.pluginAvailable)}`,
    ...state.trace.map((line) => `  ${line}`),
    `init error: ${state.lastInitError || '—'}`,
    `last banner error: ${state.lastBannerError || '—'}`,
    `last video error: ${state.lastRewardedError || '—'}`,
  ].join('\n')
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
      if (!(await ensurePlugin()) || !pluginInstance) return false
      const AdMob = pluginInstance
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
  if (!(await ensurePlugin()) || !pluginInstance) {
    return { ok: false, error: 'Video ads are available in the Android app only.' }
  }
  const AdMob = pluginInstance
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
