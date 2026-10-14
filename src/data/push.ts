import { supabase, syncToSupabase } from './supabase'
import { base64UrlToBytes, isValidPushKey } from './pushRules'

/**
 * Phone notifications (Web Push) for the installed PWA and for Chrome tabs.
 *
 * Flow
 *   1. `getPushConfig()` asks the send-push function whether the platform has
 *      VAPID keys yet, and gets the public key the browser needs. Keys are only
 *      ever public here — the private key stays in Supabase secrets.
 *   2. `enablePush()` asks for permission, subscribes through the service worker
 *      and stores the subscription with `save_push_subscription`, which stamps
 *      the caller's verified identity (so a device can never be registered
 *      against somebody else's account).
 *   3. Announcements and new vacancies are fanned out to every stored device by
 *      the same Edge Function; the service worker shows them with sound and
 *      vibration, even when the app is closed.
 */

export type PushConfig = { configured: boolean; publicKey: string | null }

export type PushOutcome = { ok: true } | { ok: false; error: string }

export type PushDeliverySummary = { sent: number; failed: number; removed: number; devices: number }

const SW_PATH = './sw.js'

/** The server's reason for a failed function call, when it sent one. */
async function functionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as Error & { context?: unknown })?.context
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: string }
      if (payload.error) return payload.error
    } catch {
      // Fall through to the SDK message below.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback
}
const TEST_TAG = 'mrc-test'

let configCache: PushConfig | null = null
let subscribeInFlight: Promise<PushOutcome> | null = null

function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

function isIosDevice(): boolean {
  return typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const media = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false
  return media || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function pushEnvironment() {
  return {
    supported: pushSupported(),
    permission: (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission) as NotificationPermission | 'unsupported',
    standalone: isStandalone(),
    isIos: isIosDevice(),
  }
}

/** Is this device already subscribed, and to which account? */
export async function currentSubscription(): Promise<{ subscribed: boolean; endpoint: string | null }> {
  if (!pushSupported()) return { subscribed: false, endpoint: null }
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    return { subscribed: Boolean(subscription), endpoint: subscription?.endpoint ?? null }
  } catch {
    return { subscribed: false, endpoint: null }
  }
}

export async function pushState() {
  const env = pushEnvironment()
  const { subscribed, endpoint } = await currentSubscription()
  return { ...env, subscribed, endpoint }
}

/**
 * Ask the server for the VAPID public key (a public value; no secrets are
 * returned). While the function is not deployed yet, a local
 * VITE_VAPID_PUBLIC_KEY is accepted so notifications can be tested on a
 * development machine — the deployed app always gets the key from the server.
 */
export async function getPushConfig(force = false): Promise<PushConfig> {
  if (configCache && !force) return configCache
  try {
    const { data, error } = await supabase.functions.invoke('send-push', { body: { action: 'config' } })
    if (!error) {
      const configured = Boolean(data?.configured) && isValidPushKey(data?.publicKey)
      configCache = { configured, publicKey: configured ? String(data.publicKey) : null }
      if (configured) return configCache
    }
  } catch {
    // Fall through to the local development key below.
  }
  const local = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (isValidPushKey(local)) {
    configCache = { configured: true, publicKey: String(local) }
    return configCache
  }
  return { configured: false, publicKey: null }
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return navigator.serviceWorker.ready
  try {
    await navigator.serviceWorker.register(SW_PATH)
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

async function storeSubscription(subscription: PushSubscription): Promise<PushOutcome> {
  const keys = subscription.toJSON().keys as { p256dh?: string; auth?: string } | undefined
  if (!keys?.p256dh || !keys.auth) {
    return { ok: false, error: 'This browser did not return usable notification keys. Please try again.' }
  }
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_user_agent: navigator.userAgent,
  })
  if (error) {
    return {
      ok: false,
      error: /could not find the function|schema cache/i.test(error.message)
        ? 'Phone notifications are being enabled on the platform. Please try again shortly.'
        : error.message || 'This device could not be registered for notifications.',
    }
  }
  return { ok: true }
}

/**
 * Turn notifications on for this device. Must be called from a user gesture —
 * the permission prompt only appears when the user tapped something.
 */
export async function enablePush(): Promise<PushOutcome> {
  if (subscribeInFlight) return subscribeInFlight
  subscribeInFlight = (async (): Promise<PushOutcome> => {
    if (!pushSupported()) return { ok: false, error: 'This browser cannot show phone notifications.' }
    if (isIosDevice() && !isStandalone()) {
      return { ok: false, error: 'On iPhone/iPad, add the app to your Home Screen first, then turn notifications on.' }
    }

    const config = await getPushConfig(true)
    if (!config.configured || !config.publicKey) {
      return { ok: false, error: 'Phone notifications are not switched on for the platform yet. Announcements still appear in the app.' }
    }

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()
    if (permission !== 'granted') {
      return { ok: false, error: permission === 'denied'
        ? 'Notifications are blocked in this browser. Allow them in the site settings (padlock icon) and try again.'
        : 'Notifications were not allowed, so nothing will be sent to this device.' }
    }

    const registration = await serviceWorkerRegistration()
    if (!registration) return { ok: false, error: 'The notification service is not ready yet. Reload the app and try again.' }

    try {
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(config.publicKey) as unknown as BufferSource,
      })
      const outcome = await storeSubscription(subscription)
      if (outcome.ok && !existing) {
        // Show one immediately, so the user sees what they just switched on.
        try {
          await registration.showNotification('Notifications are on', {
            body: 'Announcements and new vacancies will arrive like this, with sound and vibration.',
            tag: TEST_TAG,
            icon: './icon-192.png',
            badge: './icon-192.png',
          } as NotificationOptions)
        } catch {
          // Showing it is a bonus; the subscription is what matters.
        }
      }
      return outcome
    } catch (cause) {
      return { ok: false, error: cause instanceof Error
        ? `This device could not be subscribed for notifications. ${cause.message}`
        : 'This device could not be subscribed for notifications.' }
    }
  })()
  try {
    return await subscribeInFlight
  } finally {
    subscribeInFlight = null
  }
}

/** Turn notifications off for this device and forget it on the server. */
export async function disablePush(): Promise<PushOutcome> {
  if (!pushSupported()) return { ok: true }
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) {
      await supabase.rpc('delete_push_subscription', { p_endpoint: subscription.endpoint }).then(() => undefined, () => undefined)
      await subscription.unsubscribe()
    }
    return { ok: true }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Notifications could not be switched off on this device.' }
  }
}

/**
 * Re-register this device after a sign-in: the endpoint is shared by the
 * browser, so it must follow the account that is currently using the app.
 */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) await storeSubscription(subscription)
  } catch {
    // Never block sign-in on a notification problem.
  }
}

/** One test notification to the caller's own devices. */
export async function sendTestPush(): Promise<PushOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke('send-push', { body: { action: 'test' } })
    if (error) return { ok: false, error: await functionError(error, 'The test notification could not be sent.') }
    if (!data?.ok) return { ok: false, error: String(data?.error || 'No device is registered for notifications yet.') }
    return { ok: true }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'The test notification could not be sent.' }
  }
}

/**
 * Notify every subscribed device about a broadcast that already exists on the
 * server (an announcement, or the notice created for a vacancy).
 */
export async function notifyDevices(input: { notificationId?: string; jobId?: string }): Promise<PushDeliverySummary | { error: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: input.notificationId ? { action: 'notify', notificationId: input.notificationId } : { action: 'notify', jobId: input.jobId },
    })
    if (error) return { error: await functionError(error, 'Notifications could not be sent.') }
    if (!data?.ok) return { error: String(data?.error || 'Notifications could not be sent.') }
    return {
      sent: Number(data.sent ?? 0),
      failed: Number(data.failed ?? 0),
      removed: Number(data.removed ?? 0),
      devices: Number(data.devices ?? 0),
    }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'Notifications could not be sent.' }
  }
}

/**
 * Show a system notification from the app itself — used when an announcement
 * arrives while the app is open, so the phone still rings and the message stays
 * in the notification shade. Silent no-op when notifications are not allowed.
 */
export async function showSystemNotification(title: string, body: string, tag = 'mrc-update'): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return
    await registration.showNotification(title, {
      body: body.slice(0, 300),
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag,
      vibrate: [200, 100, 200],
      // The app is open, so the in-app chime already played; do not double-beep
      // on desktop where an open tab shows the notification too.
      silent: document.visibilityState === 'visible',
    } as NotificationOptions)
  } catch {
    // Notifications are a bonus; never break the screen that triggered this.
  }
}

export type PushReach = {
  devices: number
  people: number
  lastBatch: { sent: number; failed: number; removed: number; at: string } | null
  recent: { title: string; sent: number; failed: number; at: string }[]
}

/**
 * Administrator view: how many phones can be reached right now, and what the last
 * deliveries did. The database refuses this for anybody but an administrator.
 */
export async function pushReach(): Promise<PushReach | null> {
  const { data, error } = await supabase.rpc('push_subscription_stats')
  if (error || !data) return null
  const row = data as Record<string, unknown>
  const lastBatch = (row.lastBatch ?? null) as Record<string, unknown> | null
  const recent = Array.isArray(row.recent) ? row.recent as Record<string, unknown>[] : []
  return {
    devices: Number(row.devices ?? 0),
    people: Number(row.people ?? 0),
    lastBatch: lastBatch
      ? { sent: Number(lastBatch.sent ?? 0), failed: Number(lastBatch.failed ?? 0), removed: Number(lastBatch.removed ?? 0), at: String(lastBatch.at ?? '') }
      : null,
    recent: recent.map((item) => ({
      title: String(item.title ?? ''),
      sent: Number(item.sent ?? 0),
      failed: Number(item.failed ?? 0),
      at: String(item.at ?? ''),
    })),
  }
}

/** The caller's own notification devices (no endpoints returned). */
export async function myPushDevices(): Promise<{ label: string; createdAt: string }[]> {
  const { data, error } = await supabase.rpc('my_push_subscriptions')
  if (error || !Array.isArray(data)) return []
  return (data as Record<string, unknown>[]).map((row) => ({
    label: String(row.label ?? 'This device'),
    createdAt: String(row.createdAt ?? ''),
  }))
}

/**
 * Publish a notification and push it to the audience stored on its server row.
 *
 * The row is written to the server FIRST, so the words the phone shows are
 * exactly the words already stored in the recipient's notification feed. A
 * targeted notice therefore uses the same persistence and push path as a
 * broadcast without widening its audience.
 */
export async function publishToEveryone(
  notification: { id: string; title: string; body: string; type: string; target: 'all' | string[]; createdAt: number; from: string; meta?: Record<string, unknown> },
): Promise<{ delivery: PushDeliverySummary | null; error: string | null; stored: boolean }> {
  const stored = await syncToSupabase('notifications', {
    id: notification.id,
    data: notification,
    synced_at: new Date().toISOString(),
  })
  if (!stored) {
    // The app is usable without a connection; the announcement still reaches
    // every device through the user's own feed once this device syncs. Say so
    // instead of pretending the phones were notified.
    return { delivery: null, error: 'not published — this device is offline or does not have administrator access.', stored: false }
  }
  const jobId = typeof notification.meta?.jobId === 'string' ? notification.meta.jobId : null
  const outcome = await notifyDevices(jobId ? { jobId } : { notificationId: notification.id })
  if ('error' in outcome) return { delivery: null, error: outcome.error, stored: true }
  return { delivery: outcome, error: null, stored: true }
}
