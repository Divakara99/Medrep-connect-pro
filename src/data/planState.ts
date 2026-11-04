/**
 * Which plan, if any, is active on the Plans page.
 *
 * Kept out of the screen and free of React so the rule can be tested directly:
 * a pass whose days have run out must never be labelled "Active", because the
 * contact details it used to unlock are locked again at that moment. The card
 * has to say Expired and offer a renewal instead.
 */

/** The fields this module needs from a payment row (see PaymentRecord). */
export type PlanPaymentLike = {
  planId: string
  status: 'success' | 'pending' | 'failed' | 'rejected' | string
  createdAt: number
  expiresAt?: number
}

export type PlanState = {
  /** The plan covering the subscription right now, if any. */
  activePlanId: string | null
  /** When that plan runs out (epoch ms). */
  activeUntil?: number
  /** The newest pass that has run out, shown as Expired for a renewal. */
  expiredPlanId: string | null
  expiredAt?: number
  /** Every plan bought at least once, with the latest expiry it reached. */
  purchased: Map<string, number>
  /** The plan to preselect: the active one, else the one that just expired. */
  suggestedPlanId: string | null
}

/** A payment's expiry, falling back to the moment it was recorded. */
function expiryOf(payment: PlanPaymentLike): number {
  return payment.expiresAt ?? payment.createdAt
}

export function readPlanState(
  payments: PlanPaymentLike[],
  options: {
    /** isSubscribed(user) — the server says access is still paid for. */
    unlocked: boolean
    /** Plan confirmed by the checkout that just finished, before the ledger read returns. */
    purchasedPlanId?: string | null
    /** user.subscribedUntil, epoch ms. */
    subscribedUntil?: number
    now?: number
  },
): PlanState {
  const now = options.now ?? Date.now()
  const purchased = new Map<string, number>()

  // Only verified payments count. Pending, failed and rejected rows are shown
  // in the history list but never mark a plan as bought or active.
  const paid = payments
    .filter((payment) => payment.status === 'success')
    .sort((a, b) => expiryOf(b) - expiryOf(a))

  paid.forEach((payment) => {
    const at = expiryOf(payment)
    const known = purchased.get(payment.planId)
    if (known === undefined || at > known) purchased.set(payment.planId, at)
  })

  // A pass covers the subscription while its expiry is still in the future.
  const covering = paid.find((payment) => (payment.expiresAt ?? 0) > now)
  if (covering) {
    return {
      activePlanId: covering.planId,
      activeUntil: Math.max(covering.expiresAt ?? 0, options.subscribedUntil ?? 0) || undefined,
      expiredPlanId: null,
      purchased,
      suggestedPlanId: covering.planId,
    }
  }

  // The seconds right after a purchase: the checkout confirmed the plan and the
  // server says access is paid, but the ledger read has not come back yet.
  if (options.unlocked && options.purchasedPlanId) {
    return {
      activePlanId: options.purchasedPlanId,
      activeUntil: options.subscribedUntil || undefined,
      expiredPlanId: null,
      purchased,
      suggestedPlanId: options.purchasedPlanId,
    }
  }

  // Nothing covers the subscription: the newest pass is the one that ran out.
  const newest = paid[0]
  const expired = newest && expiryOf(newest) <= now ? newest : undefined
  return {
    activePlanId: null,
    expiredPlanId: expired?.planId ?? null,
    expiredAt: expired ? expiryOf(expired) : undefined,
    purchased,
    suggestedPlanId: expired?.planId ?? null,
  }
}
