import { DEFAULT_BILLING_PLANS, toBillingPlan } from './plans.ts'

Deno.test('a stored catalog row becomes the order price', () => {
  const plan = toBillingPlan({ id: 'p15', title: '15 Days Pro', days: 15, amount_paise: 19_900, active: true })
  if (!plan) throw new Error('a valid active row must be accepted')
  if (plan.amountPaise !== 19_900) throw new Error('the server price must be used verbatim')
  if (plan.days !== 15) throw new Error('the server duration must be used verbatim')
})

Deno.test('retired, malformed or impossible rows are never priced', () => {
  const rejected = [
    null,
    'p15',
    { id: 'p15', title: 'x', days: 15, amount_paise: 100, active: false },
    { id: '', title: 'x', days: 15, amount_paise: 100 },
    { id: 'p15', title: '  ', days: 15, amount_paise: 100 },
    { id: 'p15', title: 'x', days: 0, amount_paise: 100 },
    { id: 'p15', title: 'x', days: 9999, amount_paise: 100 },
    { id: 'p15', title: 'x', days: 15, amount_paise: 0 },
    { id: 'p15', title: 'x', days: 15, amount_paise: 'free' },
    { id: 'p15', title: 'x', days: 1.5, amount_paise: 100 },
  ]
  for (const row of rejected) {
    if (toBillingPlan(row) !== null) throw new Error(`row must be rejected: ${JSON.stringify(row)}`)
  }
})

Deno.test('amounts stay in paise so no rounding can drift', () => {
  for (const plan of DEFAULT_BILLING_PLANS) {
    if (!Number.isInteger(plan.amountPaise)) throw new Error(`${plan.id} must be an integer paise amount`)
    if (plan.amountPaise % 100 !== 0) throw new Error(`${plan.id} must be a whole-rupee seed price`)
    if (plan.days < 1) throw new Error(`${plan.id} must have a positive duration`)
  }
})
