/**
 * Pure rules for phone notifications. No imports, so the shipping source can be
 * tested directly in Node (scripts/test-push-rules.mjs) and the screens cannot
 * drift from the rules they display.
 */

export type PushAvailability =
  /** No Push API at all (old browser, or a non-secure origin). */
  | 'unsupported'
  /** iPhone/iPad in Safari: iOS only delivers push to an installed (Home Screen) app. */
  | 'needs-install'
  /** Supported and never asked: show the "turn on" button. */
  | 'ask'
  /** The user said no in the browser: only the browser settings can undo that. */
  | 'denied'
  /** On in this app, and the browser accepted the subscription. */
  | 'on'
  /** Allowed, but switching accounts/browsers means it is not registered yet. */
  | 'off'
  /** The browser is fine, but the platform has no VAPID keys yet (server side). */
  | 'platform-off'

export type PushEnvironment = {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  standalone: boolean
  isIos: boolean
  /** Does the server have VAPID keys yet? Not configured means nothing can subscribe. */
  platformReady?: boolean
}

export const PUSH_MAX_TITLE = 80
export const PUSH_MAX_MESSAGE = 600
/** How many devices one announcement may ring before the admin is warned. */
export const ANNOUNCEMENT_WARN_DEVICES = 500

export function base64UrlToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/').trim()
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** The VAPID public key must be a 65-byte uncompressed P-256 point. */
export function isValidPushKey(base64: string | null | undefined): boolean {
  if (!base64) return false
  try {
    const bytes = base64UrlToBytes(base64)
    return bytes.length === 65 && bytes[0] === 0x04
  } catch {
    return false
  }
}

/** What the notification card should say and offer, given the environment. */
export function pushAvailability(env: PushEnvironment): PushAvailability {
  if (!env.supported) return 'unsupported'
  if (env.isIos && !env.standalone) return 'needs-install'
  if (env.permission === 'denied') return 'denied'
  if (env.platformReady === false) return 'platform-off'
  if (env.permission === 'granted') return env.subscribed ? 'on' : 'off'
  return 'ask'
}

/** A message the user can act on — never a raw permission string. */
export function pushAvailabilityMessage(state: PushAvailability): string {
  switch (state) {
    case 'unsupported':
      return 'This browser cannot show phone notifications. Open the app in Chrome (Android or desktop) to switch them on.'
    case 'needs-install':
      return 'On iPhone/iPad, add MedRep Connect Pro to the Home Screen first (Share → Add to Home Screen), then turn notifications on here.'
    case 'denied':
      return 'Notifications are blocked for this site in your browser. Allow them in the browser’s site settings (the padlock icon next to the address), then come back.'
    case 'ask':
      return 'Turn on notifications to hear about new vacancies and platform announcements even when the app is closed.'
    case 'off':
      return 'Notifications are allowed but this device is not registered yet. Turn them on to receive announcements.'
    case 'platform-off':
      return 'Phone notifications are being enabled on the platform. Until then, announcements still arrive in the app — with sound while it is open.'
    case 'on':
      return 'This device receives announcements and new vacancies, with sound and vibration, even when the app is closed.'
  }
}

/** Validates the announcement an administrator is about to send to everyone. */
export function announcementProblem(title: string, message: string): string | null {
  const cleanTitle = title.trim()
  const cleanMessage = message.trim()
  if (cleanTitle.length < 3) return 'Give the announcement a short title (at least 3 characters).'
  if (cleanTitle.length > PUSH_MAX_TITLE) return `Keep the title under ${PUSH_MAX_TITLE} characters.`
  if (cleanMessage.length < 10) return 'Write the announcement message (at least 10 characters).'
  if (cleanMessage.length > PUSH_MAX_MESSAGE) return `Keep the message under ${PUSH_MAX_MESSAGE} characters.`
  return null
}

/** The exact text every device will show, including the sign-off line. */
export function announcementBody(message: string, signOff: string): string {
  return `${message.trim()}\n\n${signOff}`
}

/**
 * Which notifications deserve a ring: those that arrived since the last check on
 * this device. The very first check (watermark 0) only records the watermark, so
 * a fresh install never rings for the whole backlog.
 */
export function notificationsToAlert<T extends { id: string; createdAt: number }>(
  list: T[],
  knownIds: Iterable<string>,
  watermark: number,
  limit = 3,
): T[] {
  if (watermark <= 0) return []
  const known = new Set(knownIds)
  return list
    .filter((item) => !known.has(item.id) && item.createdAt > watermark)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, limit))
}

/** The watermark to store after a check: never moves backwards. */
export function nextWatermark(current: number, list: { createdAt: number }[], alerted: { createdAt: number }[]): number {
  if (current <= 0) return list.reduce((max, item) => Math.max(max, item.createdAt), 0)
  if (alerted.length === 0) return current
  return Math.max(current, ...alerted.map((item) => item.createdAt))
}

/** Sound is on unless the user turned it off on this device. */
export function shouldChime(soundEnabled: boolean, alertedCount: number): boolean {
  return soundEnabled && alertedCount > 0
}
