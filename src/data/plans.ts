import { remove } from './storage'
import { broadcast } from './notifications'
import { mirror, supabase } from './supabase'

/**
 * Subscription plans.
 *
 * The authoritative catalog is the server table `public.billing_plans`. Prices
 * and durations are read from it and are never taken from the browser: the
 * Razorpay Edge Function prices an order from the same table, so the amount the
 * user sees is the amount charged.
 *
 * An MFA-verified administrator edits the catalog with savePlans(); the
 * database refuses the call for any session without a verified authenticator.
 */
export type Plan = {
  id: string
  title: string
  days: number
  price: number // INR, derived from the server's amount_paise
  tagline: string
  popular?: boolean
  active: boolean
  updatedAt?: number
}

/**
 * Display-only fallback so the Plans screen still renders if the catalog read
 * fails (for example before the billing migration has been run). These values
 * can never start a checkout: create-razorpay-order reads the server table.
 */
export const FALLBACK_PLANS: Plan[] = [
  { id: 'p5', title: '5 Days Trial', days: 5, price: 49, tagline: 'Quick access — test the network', active: true },
  { id: 'p10', title: '10 Days Basic', days: 10, price: 99, tagline: 'Short hunt for a field role', active: true },
  { id: 'p15', title: '15 Days Pro', days: 15, price: 149, tagline: 'Most chosen for MR switchers', popular: true, active: true },
  { id: 'p30', title: '30 Days Standard', days: 30, price: 249, tagline: 'Full month of unlocked jobs', active: true },
  { id: 'p90', title: '3 Months Premium', days: 90, price: 599, tagline: 'Serious job seekers', active: true },
  { id: 'p180', title: '6 Months Elite', days: 180, price: 999, tagline: 'Long-haul career move', active: true },
  { id: 'p365', title: '1 Year Ultimate', days: 365, price: 1799, tagline: 'Best value — year-long access', active: true },
]

// The previous build kept editable display overrides (and once prices) in
// localStorage. Nothing about pricing is read from the browser any more.
remove('mrc_plans_v1')

type BillingPlanRow = {
  id: string
  title: string
  days: number
  amount_paise: number | string
  tagline: string | null
  popular: boolean | null
  active: boolean | null
  updated_at: string | null
}

function toPlan(row: BillingPlanRow): Plan {
  return {
    id: row.id,
    title: row.title,
    days: row.days,
    price: Number(row.amount_paise) / 100,
    tagline: row.tagline ?? '',
    popular: row.popular === true,
    active: row.active !== false,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
  }
}

let plans: Plan[] = FALLBACK_PLANS

/** Last loaded catalog (fallback list until refreshPlans() resolves). */
export function getPlans(): Plan[] {
  return plans.filter((plan) => plan.active)
}

export function getAllPlansIncludingRetired(): Plan[] {
  return plans
}

export async function refreshPlans(): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('billing_plans')
    .select('id,title,days,amount_paise,tagline,popular,active,updated_at')
    .order('days', { ascending: true })
    .limit(100)
  if (error) throw new Error(error.message || 'The subscription catalog could not be loaded.')
  const loaded = ((data ?? []) as unknown as BillingPlanRow[]).map(toPlan)
  if (loaded.length > 0) plans = loaded
  return plans
}

export type SavePlansResult = { ok: true; plans: Plan[] } | { ok: false; error: string }

/**
 * Administrator-only: write the catalog back to the server. The database checks
 * the trusted admin role plus a verified authenticator (aal2) before accepting
 * a price change, and rejects retiring the last purchasable plan.
 */
export async function savePlans(next: Plan[]): Promise<SavePlansResult> {
  try {
    for (const plan of next) {
      const { error } = await supabase.rpc('save_billing_plan', {
        p_id: plan.id,
        p_title: plan.title.trim(),
        p_days: plan.days,
        p_amount_paise: Math.round(plan.price * 100),
        p_tagline: plan.tagline ?? '',
        p_popular: plan.popular === true,
        p_active: plan.active !== false,
      })
      if (error) {
        return {
          ok: false,
          error: /42501|MFA-verified/i.test(error.message)
            ? 'Plan pricing can only be changed by an MFA-verified administrator. Verify your authenticator and try again.'
            : error.message || 'Plan changes could not be saved.',
        }
      }
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Plan changes could not be saved.' }
  }

  const saved = await refreshPlans()
  saved.forEach((plan) => mirror('plans', plan))
  broadcast({ kind: 'plans-updated' }, { type: 'plan' })
  return { ok: true, plans: saved }
}
