/**
 * Pure rules for the vacancy team and the admin payments view. No imports, so
 * they can be tested directly in Node (scripts/test-vacancy-rules.mjs) and the
 * screens cannot drift from them.
 */

export const DELETE_REASON_MIN = 5
export const DELETE_REASON_MAX = 300

/** Returns a message when the reason is not acceptable, otherwise null. */
export function deleteReasonProblem(reason: string): string | null {
  const text = reason.trim()
  if (text.length < DELETE_REASON_MIN) return `Give a reason for the deletion (at least ${DELETE_REASON_MIN} characters).`
  if (text.length > DELETE_REASON_MAX) return `Keep the reason under ${DELETE_REASON_MAX} characters.`
  return null
}

export type ActorRole = 'admin' | 'vacancy_editor' | 'system' | 'earlier'

export type AuditRow = {
  id: number
  action: 'added' | 'deleted'
  vacancyId: string
  title: string
  company: string
  location: string
  category: string
  actorRole: ActorRole
  actorEmail: string
  reason: string | null
  createdAt: number
}

/** Plain words for who did something, shown in the admin activity tables. */
export function actorLabel(row: Pick<AuditRow, 'actorRole' | 'actorEmail'>): string {
  switch (row.actorRole) {
    case 'admin': return 'Admin'
    case 'vacancy_editor': return row.actorEmail || 'Vacancy team'
    case 'earlier': return 'Before tracking'
    default: return 'System'
  }
}

export type ActivitySummary = {
  added: number
  deleted: number
  addedByTeam: number
  deletedByTeam: number
  byActor: { label: string; role: ActorRole; added: number; deleted: number }[]
  reasons: { reason: string; count: number }[]
}

/** Totals, per-person counts and deletion reasons, most frequent first. */
export function summarizeActivity(rows: AuditRow[]): ActivitySummary {
  const actors = new Map<string, { label: string; role: ActorRole; added: number; deleted: number }>()
  const reasons = new Map<string, number>()
  let added = 0
  let deleted = 0
  let addedByTeam = 0
  let deletedByTeam = 0

  for (const row of rows) {
    const label = actorLabel(row)
    const key = `${row.actorRole}|${label}`
    const entry = actors.get(key) ?? { label, role: row.actorRole, added: 0, deleted: 0 }
    if (row.action === 'added') {
      added += 1
      entry.added += 1
      if (row.actorRole === 'vacancy_editor') addedByTeam += 1
    } else {
      deleted += 1
      entry.deleted += 1
      if (row.actorRole === 'vacancy_editor') deletedByTeam += 1
      const reason = row.reason?.trim() || 'No reason recorded'
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
    actors.set(key, entry)
  }

  return {
    added,
    deleted,
    addedByTeam,
    deletedByTeam,
    byActor: [...actors.values()].sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted) || a.label.localeCompare(b.label)),
    reasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  }
}

// ---------------------------------------------------------------------------
// Payments: one clear label per type and status, so the table reads without
// explanation.
// ---------------------------------------------------------------------------

export type PaymentMethod = 'Razorpay' | 'UPI' | 'Manual grant'

export type PaymentLike = {
  paymentMethod?: PaymentMethod
  status: 'success' | 'pending' | 'failed' | 'rejected'
  manualReview?: boolean
}

export function paymentTypeLabel(method: PaymentMethod | undefined): string {
  switch (method) {
    case 'Razorpay': return 'Online (Razorpay)'
    case 'UPI': return 'UPI transfer (bank check)'
    case 'Manual grant': return 'Free grant by admin'
    default: return 'Unknown type'
  }
}

export function paymentStatusLabel(payment: PaymentLike): string {
  if (payment.manualReview) return 'Waiting bank check'
  switch (payment.status) {
    case 'success': return 'Paid'
    case 'pending': return 'Pending'
    case 'failed': return 'Failed'
    case 'rejected': return 'Rejected'
  }
}

export type Tone = 'green' | 'amber' | 'red' | 'slate'

export function paymentStatusTone(payment: PaymentLike): Tone {
  if (payment.manualReview) return 'amber'
  switch (payment.status) {
    case 'success': return 'green'
    case 'pending': return 'amber'
    case 'failed':
    case 'rejected': return 'red'
  }
}

export type PaymentTotals = {
  paidCount: number
  paidAmount: number
  pendingCount: number
  waitingBankCheck: number
  failedCount: number
}

export function paymentTotals<T extends PaymentLike & { amount: number }>(payments: T[]): PaymentTotals {
  return payments.reduce<PaymentTotals>((totals, payment) => {
    if (payment.manualReview) totals.waitingBankCheck += 1
    else if (payment.status === 'success') {
      totals.paidCount += 1
      totals.paidAmount += payment.amount
    } else if (payment.status === 'pending') totals.pendingCount += 1
    else if (payment.status === 'failed' || payment.status === 'rejected') totals.failedCount += 1
    return totals
  }, { paidCount: 0, paidAmount: 0, pendingCount: 0, waitingBankCheck: 0, failedCount: 0 })
}
