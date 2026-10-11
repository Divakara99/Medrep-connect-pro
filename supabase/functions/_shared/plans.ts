export type BillingPlan = {
  id: string
  title: string
  days: number
  amountRupees: number
}

// Authoritative billing values. Keep these in sync with src/data/plans.ts.
// Neither amount nor duration is accepted from the browser.
export const BILLING_PLANS: Record<string, BillingPlan> = {
  p5: { id: 'p5', title: '5 Days Trial', days: 5, amountRupees: 49 },
  p10: { id: 'p10', title: '10 Days Basic', days: 10, amountRupees: 99 },
  p15: { id: 'p15', title: '15 Days Pro', days: 15, amountRupees: 149 },
  p30: { id: 'p30', title: '30 Days Standard', days: 30, amountRupees: 249 },
  p90: { id: 'p90', title: '3 Months Premium', days: 90, amountRupees: 599 },
  p180: { id: 'p180', title: '6 Months Elite', days: 180, amountRupees: 999 },
  p365: { id: 'p365', title: '1 Year Ultimate', days: 365, amountRupees: 1799 },
}

export function findBillingPlan(planId: unknown): BillingPlan | null {
  return typeof planId === 'string' ? BILLING_PLANS[planId] ?? null : null
}
