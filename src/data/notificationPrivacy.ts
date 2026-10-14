/**
 * Privacy rules for notification audiences. Kept pure so client filtering and
 * tests use the same fail-closed rules.
 */
export type NotificationPrivacyShape = {
  type?: unknown
  title?: unknown
  target?: unknown
  meta?: unknown
}

export function isRefundNotification(value: NotificationPrivacyShape | null | undefined): boolean {
  if (!value || typeof value !== 'object') return false
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const meta = value.meta && typeof value.meta === 'object'
    ? value.meta as Record<string, unknown>
    : null

  // Earlier refund notices were tagged as ordinary payments and carried the
  // payment id in meta. Recognize both those rows and title-only server rows.
  return /^refund\b/i.test(title)
    || (value.type === 'payment' && typeof meta?.paymentId === 'string')
}

/** A refund event is personal data: it must never use the broadcast audience. */
export function privateNotificationTarget(email: string): string[] | null {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null
  return [normalized]
}

/** Normalize an audience and refuse to build a refund notice without one owner. */
export function notificationAudience(
  isRefundEvent: boolean,
  requested?: 'all' | string[],
): 'all' | string[] | null {
  const target: 'all' | string[] = requested === undefined || requested === 'all'
    ? 'all'
    : [...new Set(requested.map((email) => email.trim().toLowerCase()).filter(Boolean))]
  if (!isRefundEvent) return target
  if (target === 'all' || target.length !== 1) return null
  return privateNotificationTarget(target[0])
}

/** Whether a notification is safe and addressed for this signed-in account. */
export function notificationVisibleToEmail(value: NotificationPrivacyShape, email: string): boolean {
  const normalizedEmail = email.trim().toLowerCase()
  const target = value.target

  if (target === 'all' || target === undefined || target === null) {
    // Hide legacy refund rows that were accidentally saved as broadcasts.
    return !isRefundNotification(value)
  }

  if (!Array.isArray(target) || !normalizedEmail) return false
  if (isRefundNotification(value) && target.length !== 1) return false
  return target.some((recipient) =>
    typeof recipient === 'string' && recipient.trim().toLowerCase() === normalizedEmail,
  )
}

/** Only broadcast-safe rows belong in the shared, device-wide local cache. */
export function isBroadcastNotification(value: NotificationPrivacyShape): boolean {
  return (value.target === 'all' || value.target === undefined || value.target === null)
    && !isRefundNotification(value)
}
