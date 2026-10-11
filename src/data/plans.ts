import { read, write } from './storage'
import { broadcast } from './notifications'
import { mirror } from './supabase'

export type Plan = {
  id: string
  title: string
  days: number
  price: number // INR — authoritative server-side billing catalog values
  tagline: string
  popular?: boolean
}

const PLANS_KEY = 'mrc_plans_v1'

/**
 * These prices and durations are mirrored by the Supabase Edge Functions.
 * They are fixed for client display only; payment amounts and entitlement
 * duration are always taken from the server-side catalog.
 */
export const BILLING_PLANS: Plan[] = [
  { id: 'p5', title: '5 Days Trial', days: 5, price: 49, tagline: 'Quick access — test the network' },
  { id: 'p10', title: '10 Days Basic', days: 10, price: 99, tagline: 'Short hunt for a field role' },
  { id: 'p15', title: '15 Days Pro', days: 15, price: 149, tagline: 'Most chosen for MR switchers', popular: true },
  { id: 'p30', title: '30 Days Standard', days: 30, price: 249, tagline: 'Full month of unlocked jobs' },
  { id: 'p90', title: '3 Months Premium', days: 90, price: 599, tagline: 'Serious job seekers' },
  { id: 'p180', title: '6 Months Elite', days: 180, price: 999, tagline: 'Long-haul career move' },
  { id: 'p365', title: '1 Year Ultimate', days: 365, price: 1799, tagline: 'Best value — year-long access' },
]

function readDisplayOverrides(): Partial<Plan>[] {
  return read<Partial<Plan>[]>(PLANS_KEY, [])
}

export function getPlans(): Plan[] {
  const overrides = readDisplayOverrides()
  return BILLING_PLANS.map((plan) => {
    const override = overrides.find((candidate) => candidate.id === plan.id)
    return {
      ...plan,
      title: typeof override?.title === 'string' && override.title.trim() ? override.title.trim() : plan.title,
      tagline: typeof override?.tagline === 'string' ? override.tagline : plan.tagline,
      popular: typeof override?.popular === 'boolean' ? override.popular : plan.popular,
      // Price and validity are intentionally not read from localStorage.
      price: plan.price,
      days: plan.days,
    }
  })
}

export function savePlans(plans: Plan[]) {
  const displayOverrides = BILLING_PLANS.map((plan) => {
    const candidate = plans.find((item) => item.id === plan.id)
    return {
      id: plan.id,
      title: candidate?.title?.trim() || plan.title,
      tagline: candidate?.tagline ?? plan.tagline,
      popular: candidate?.popular ?? plan.popular,
      price: plan.price,
      days: plan.days,
    }
  })
  write(PLANS_KEY, displayOverrides)
  displayOverrides.forEach((plan) => mirror('plans', plan))
  broadcast({ kind: 'plans-updated' }, { type: 'plan' })
}

export function resetPlans() {
  write(PLANS_KEY, [])
  BILLING_PLANS.forEach((plan) => mirror('plans', plan))
  broadcast({ kind: 'plans-updated' }, { type: 'plan' })
}
