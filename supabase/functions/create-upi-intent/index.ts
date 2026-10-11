import { authenticate, isResponse, optionsResponse } from '../_shared/supabase.ts'
import { jsonResponse, readJson } from '../_shared/http.ts'
import { findBillingPlan } from '../_shared/plans.ts'

const DEFAULT_MERCHANT_UPI_VPA = 'akhildivakara4@ybl'

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const context = await authenticate(request)
  if (isResponse(context)) return context

  const body = await readJson(request)
  const plan = findBillingPlan(body?.planId)
  if (!plan) return jsonResponse({ error: 'Choose a valid subscription plan.' }, 400)

  const vpa = Deno.env.get('MERCHANT_UPI_VPA')?.trim() || DEFAULT_MERCHANT_UPI_VPA
  if (!/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/.test(vpa)) {
    return jsonResponse({ error: 'The merchant UPI address is not configured correctly.' }, 503)
  }

  const paymentRecordId = crypto.randomUUID()
  const upiReference = `MRC${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`
  const amountPaise = plan.amountRupees * 100
  const payParams = new URLSearchParams({
    pa: vpa,
    pn: 'MedRep Connect Pro',
    tr: upiReference,
    tn: `Plan ${plan.id} ${upiReference}`,
    am: (amountPaise / 100).toFixed(2),
    cu: 'INR',
  })
  const upiUri = `upi://pay?${payParams.toString()}`

  const { error } = await context.adminClient
    .from('subscription_payments')
    .insert({
      id: paymentRecordId,
      user_id: context.user.id,
      plan_id: plan.id,
      plan_title: plan.title,
      plan_days: plan.days,
      amount_paise: amountPaise,
      currency: 'INR',
      payment_method: 'upi_manual',
      payment_status: 'pending',
      upi_reference: upiReference,
    })
  if (error) {
    console.error('Could not store the pending manual UPI request:', error.message)
    return jsonResponse({ error: 'The UPI request could not be recorded. Please try again.' }, 500)
  }

  return jsonResponse({
    ok: true,
    paymentRecordId,
    upiReference,
    vpa,
    upiUri,
    amountRupees: plan.amountRupees,
    planId: plan.id,
    planTitle: plan.title,
    planDays: plan.days,
  })
})
