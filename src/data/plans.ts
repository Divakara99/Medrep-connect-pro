import { read, write } from './storage'
import { broadcast } from './notifications'
import { mirror } from './supabase'

export type Plan = {
  id: string
  title: string
  days: number
  price: number // INR
  tagline: string
  popular?: boolean
}

const PLANS_KEY = 'mrc_plans_v1'

const DEFAULT_PLANS: Plan[] = [
  { id: 'p5', title: '5 Days Trial', days: 5, price: 49, tagline: 'Quick access — test the network' },
  { id: 'p10', title: '10 Days Basic', days: 10, price: 99, tagline: 'Short hunt for a field role' },
  { id: 'p15', title: '15 Days Pro', days: 15, price: 149, tagline: 'Most chosen for MR switchers', popular: true },
  { id: 'p30', title: '30 Days Standard', days: 30, price: 249, tagline: 'Full month of unlocked jobs' },
  { id: 'p90', title: '3 Months Premium', days: 90, price: 599, tagline: 'Serious job seekers' },
  { id: 'p180', title: '6 Months Elite', days: 180, price: 999, tagline: 'Long-haul career move' },
  { id: 'p365', title: '1 Year Ultimate', days: 365, price: 1799, tagline: 'Best value — year-long access' },
]

export function getPlans(): Plan[] {
  return read<Plan[]>(PLANS_KEY, DEFAULT_PLANS)
}

export function savePlans(plans: Plan[]) {
  write(PLANS_KEY, plans)
  plans.forEach((plan) => mirror('plans', plan))
  broadcast({ kind: 'plans-updated' }, { type: 'plan' })
}

export function resetPlans() {
  write(PLANS_KEY, DEFAULT_PLANS)
  DEFAULT_PLANS.forEach((plan) => mirror('plans', plan))
}
