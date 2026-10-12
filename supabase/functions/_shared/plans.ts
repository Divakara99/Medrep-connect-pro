import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Database } from './supabase.ts'

export type BillingPlan = {
  id: string
  title: string
  days: number
  amountPaise: number
}

/**
 * Seed values for the server catalog. supabase/billing_plans.sql inserts these
 * with ON CONFLICT DO NOTHING, so they are a reference only — the authoritative
 * price and duration always come from the public.billing_plans row. An
 * administrator can change them from the admin panel (MFA-verified), and no
 * amount or duration is ever accepted from the browser.
 */
export const DEFAULT_BILLING_PLANS: BillingPlan[] = [
  { id: 'p5', title: '5 Days Trial', days: 5, amountPaise: 4_900 },
  { id: 'p10', title: '10 Days Basic', days: 10, amountPaise: 9_900 },
  { id: 'p15', title: '15 Days Pro', days: 15, amountPaise: 14_900 },
  { id: 'p30', title: '30 Days Standard', days: 30, amountPaise: 24_900 },
  { id: 'p90', title: '3 Months Premium', days: 90, amountPaise: 59_900 },
  { id: 'p180', title: '6 Months Elite', days: 180, amountPaise: 99_900 },
  { id: 'p365', title: '1 Year Ultimate', days: 365, amountPaise: 179_900 },
]

type BillingPlanRow = {
  id?: unknown
  title?: unknown
  days?: unknown
  amount_paise?: unknown
  active?: unknown
}

/**
 * Strict row → plan conversion. A malformed or retired row is rejected rather
 * than silently priced, so a broken catalog row can never start a checkout.
 */
export function toBillingPlan(row: unknown): BillingPlan | null {
  if (!row || typeof row !== 'object') return null
  const candidate = row as BillingPlanRow
  if (candidate.active === false) return null
  if (typeof candidate.id !== 'string' || candidate.id.trim() === '') return null
  if (typeof candidate.title !== 'string' || candidate.title.trim() === '') return null

  const days = Number(candidate.days)
  const amountPaise = Number(candidate.amount_paise)
  if (!Number.isInteger(days) || days < 1 || days > 3650) return null
  if (!Number.isInteger(amountPaise) || amountPaise < 100) return null

  return { id: candidate.id.trim(), title: candidate.title.trim(), days, amountPaise }
}

/**
 * Load the purchasable plan the user selected. Called with the service-role
 * client so the read is not affected by the caller's RLS, and the row itself is
 * what prices the Razorpay order.
 */
export async function fetchActiveBillingPlan(
  client: SupabaseClient<Database, 'public'>,
  planId: unknown,
): Promise<BillingPlan | null> {
  if (typeof planId !== 'string' || planId.trim() === '') return null
  const { data, error } = await client
    .from('billing_plans')
    .select('id,title,days,amount_paise,active')
    .eq('id', planId.trim())
    .eq('active', true)
    .maybeSingle()
  if (error) throw new Error('The subscription catalog could not be read. Please contact support.')
  return toBillingPlan(data)
}
