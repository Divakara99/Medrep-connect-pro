import { authenticate, isResponse, optionsResponse } from '../_shared/supabase.ts'
import { jsonResponse, readJson } from '../_shared/http.ts'
import { findBillingPlan } from '../_shared/plans.ts'
import { createRazorpayOrder, razorpayCredentials } from '../_shared/razorpay.ts'

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const context = await authenticate(request)
  if (isResponse(context)) return context

  const body = await readJson(request)
  const plan = findBillingPlan(body?.planId)
  if (!plan) return jsonResponse({ error: 'Choose a valid subscription plan.' }, 400)

  try {
    const { keyId } = razorpayCredentials()
    const paymentRecordId = crypto.randomUUID()
    const receipt = `mrc_${crypto.randomUUID().replaceAll('-', '')}`
    const amountPaise = plan.amountRupees * 100
    const order = await createRazorpayOrder({
      amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        user_id: context.user.id,
        plan_id: plan.id,
        payment_record_id: paymentRecordId,
      },
    })

    const { error: insertError } = await context.adminClient
      .from('subscription_payments')
      .insert({
        id: paymentRecordId,
        user_id: context.user.id,
        plan_id: plan.id,
        plan_title: plan.title,
        plan_days: plan.days,
        amount_paise: amountPaise,
        currency: 'INR',
        payment_method: 'razorpay',
        payment_status: 'pending',
        razorpay_order_id: order.id,
      })
    if (insertError) {
      // Log only the database error code; the message can echo row values.
      console.error('Failed to store the pending Razorpay order:', { dbErrorCode: insertError.code ?? 'unavailable' })
      return jsonResponse({ error: 'The payment order could not be recorded. Please contact support before retrying.' }, 500)
    }

    return jsonResponse({
      ok: true,
      paymentRecordId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
      planId: plan.id,
      planTitle: plan.title,
      planDays: plan.days,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment service is unavailable.'
    const status = /not configured/i.test(message) ? 503 : 502
    console.error('Razorpay order creation failed:', message)
    return jsonResponse({ error: status === 503 ? message : 'Razorpay could not start checkout. Please try again later.' }, status, true)
  }
})
