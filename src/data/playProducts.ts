import type { Plan } from './plans'

/**
 * Plan ↔ Google Play product mapping (pure, unit-tested).
 *
 * Each billing plan becomes one one-time "N-day pass" product in Play
 * Console. The authoritative mapping is the `play_product_id` column on
 * public.billing_plans (see supabase/google_play_billing.sql); these
 * defaults seed that column and name the products to create in Play
 * Console (ANDROID.md lists them one by one).
 */
export const DEFAULT_PLAY_PRODUCT_IDS: Record<string, string> = {
  p5: 'medrep_pass_5d',
  p10: 'medrep_pass_10d',
  p15: 'medrep_pass_15d',
  p30: 'medrep_pass_30d',
  p90: 'medrep_pass_90d',
  p180: 'medrep_pass_180d',
  p365: 'medrep_pass_365d',
}

export function defaultPlayProductId(planId: string): string | undefined {
  return DEFAULT_PLAY_PRODUCT_IDS[planId]
}

/** Plans that can actually be bought on Google Play right now. */
export function playPurchasablePlans(plans: Plan[]): Plan[] {
  return plans.filter((plan) => Boolean(plan.playProductId))
}
