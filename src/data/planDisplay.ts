/**
 * How a plan is written on screen.
 *
 * Titles come from the server catalog (`billing_plans.title`), which is edited
 * by hand in the admin panel. A row can therefore read "1 Days Trial" — and
 * correcting it means a production data write. Rather than require one, the
 * screen fixes the singular on the way out; the numbers and prices are still
 * entirely the server's.
 */

/** "1 Days Trial" → "1 Day Trial". Any other title is returned untouched. */
export function planTitle(title: string): string {
  const trimmed = (title ?? '').trim()
  if (!trimmed) return 'Plan'
  // Only a leading/standalone "1 Days" is wrong; "11 Days", "21 Days" and
  // "1 Days 2 Nights"-style text must not be touched.
  return trimmed.replace(/\b1\s+Days\b/g, '1 Day')
}

/** 1 → "1 day", 15 → "15 days", 365 → "365 days". */
export function daysLabel(days: number): string {
  const value = Number.isFinite(days) ? Math.max(1, Math.round(days)) : 1
  return value === 1 ? '1 day' : `${value} days`
}

/** "15 days of access" — the phrase used under a plan's title. */
export function accessLabel(days: number): string {
  return `${daysLabel(days)} of access`
}

/** The short price-period label on a plan card: day / month / year. */
export function periodLabel(days: number): string {
  if (days >= 365) {
    const years = Math.round(days / 365)
    return years === 1 ? '1 year' : `${years} years`
  }
  if (days >= 30) {
    const months = Math.round(days / 30)
    return months === 1 ? '1 month' : `${months} months`
  }
  return daysLabel(days)
}

/**
 * The day a payment belongs to, as a history heading.
 *
 * "Today" and "Yesterday" are what people actually recognise; older days get a
 * full date so a receipt is never ambiguous. The grouping key is the local
 * midnight of that day, so two payments at 23:55 and 00:05 are two days — which
 * is exactly how a bank statement reads them.
 */
export function paymentDayStart(ts: number): number {
  const date = new Date(ts)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function paymentDayLabel(dayStart: number, now = Date.now()): string {
  const today = paymentDayStart(now)
  const oneDay = 86_400_000
  if (dayStart === today) return 'Today'
  if (dayStart === today - oneDay) return 'Yesterday'
  return new Date(dayStart).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** The one-line state of a payment, in the words a buyer would use. */
export function paymentStatusLabel(status: string, manualReview = false): string {
  if (manualReview) return 'Awaiting UPI verification'
  if (status === 'success') return 'Paid'
  if (status === 'pending') return 'Pending'
  if (status === 'rejected') return 'Rejected'
  return 'Failed'
}
