import { authenticate, isResponse, optionsResponse } from '../_shared/supabase.ts'
import { jsonResponse, readJson } from '../_shared/http.ts'
import { captureRazorpayPayment, fetchRazorpayPayment, verifyCheckoutSignature } from '../_shared/razorpay.ts'

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const context = await authenticate(request)
  if (isResponse(context)) return context

  const body = await readJson(request)
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : ''
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const signature = typeof body?.signature === 'string' ? body.signature.trim().toLowerCase() : ''
  if (!/^order_[A-Za-z0-9]+$/.test(orderId)
    || !/^pay_[A-Za-z0-9]+$/.test(paymentId)
    || !/^[a-f0-9]{64}$/.test(signature)) {
    return jsonResponse({ error: 'Payment confirmation details are incomplete.' }, 400)
  }

  const { data: storedPayment, error: selectError } = await context.adminClient
    .from('subscription_payments')
    .select('id,user_id,plan_id,plan_days,amount_paise,currency,payment_status,razorpay_payment_id,expires_at')
    .eq('razorpay_order_id', orderId)
    .eq('user_id', context.user.id)
    .maybeSingle()
  if (selectError) {
    console.error('Could not load the subscription payment:', selectError.message)
    return jsonResponse({ error: 'Payment records are not configured. Contact support.' }, 503)
  }
  if (!storedPayment) return jsonResponse({ error: 'This payment order does not belong to your account.' }, 404)

  if (storedPayment.payment_status === 'paid') {
    if (storedPayment.razorpay_payment_id !== paymentId) {
      return jsonResponse({ error: 'This order was confirmed using a different payment.' }, 409)
    }
    return jsonResponse({
      ok: true,
      activated: true,
      expiresAt: storedPayment.expires_at,
      planId: storedPayment.plan_id,
      planDays: storedPayment.plan_days,
      paymentId: storedPayment.id,
      gatewayPaymentId: paymentId,
      alreadyConfirmed: true,
    })
  }
  if (storedPayment.payment_status !== 'pending') {
    return jsonResponse({ error: 'This payment order is no longer pending.' }, 409)
  }

  const secret = Deno.env.get('RAZORPAY_KEY_SECRET')?.trim()
  if (!secret) return jsonResponse({ error: 'Razorpay server verification is not configured.' }, 503)

  try {
    const validSignature = await verifyCheckoutSignature(secret, orderId, paymentId, signature)
    if (!validSignature) return jsonResponse({ error: 'Razorpay payment signature is invalid.' }, 403)

    let payment = await fetchRazorpayPayment(paymentId)
    if (payment.entity !== 'payment'
      || payment.order_id !== orderId
      || payment.amount !== Number(storedPayment.amount_paise)
      || payment.currency !== 'INR') {
      return jsonResponse({ error: 'Razorpay payment details do not match the selected plan.' }, 409)
    }

    if (payment.status === 'authorized') {
      // Capture only the signature-verified payment for this server-priced
      // order. If auto-capture raced with this request, re-fetch the status.
      try {
        await captureRazorpayPayment(paymentId, Number(storedPayment.amount_paise))
      } catch (captureError) {
        console.warn('Razorpay capture is not complete yet:', captureError instanceof Error ? captureError.message : captureError)
      }
      payment = await fetchRazorpayPayment(paymentId)
    }

    if (payment.status !== 'captured') {
      return jsonResponse({
        ok: false,
        activated: false,
        paymentStatus: payment.status,
        message: 'Razorpay has not marked this payment as captured yet. Your plan will activate only after capture is verified.',
      }, 202)
    }

    const rawUtr = payment.acquirer_data?.rrn
    const utr = typeof rawUtr === 'string' || typeof rawUtr === 'number' ? String(rawUtr) : null
    const { data: confirmation, error: confirmError } = await context.adminClient.rpc(
      'confirm_razorpay_subscription_payment',
      {
        p_gateway_order_id: orderId,
        p_gateway_payment_id: paymentId,
        p_paid_amount_paise: payment.amount,
        p_gateway_method: payment.method ?? '',
        p_utr: utr,
      },
    )
    if (confirmError) {
      console.error('Verified payment could not be applied:', confirmError.message)
      return jsonResponse({ error: 'Payment is verified, but activation could not be completed. Please contact support with your Razorpay payment ID.' }, 500)
    }

    const result = (Array.isArray(confirmation) ? confirmation[0] : confirmation) as Record<string, unknown> | null
    if (!result || typeof result.expiresAt !== 'string') {
      return jsonResponse({ error: 'Payment is verified, but activation could not be confirmed. Please contact support.' }, 500)
    }

    return jsonResponse({
      ok: true,
      activated: true,
      expiresAt: result.expiresAt,
      planId: result.planId,
      planDays: result.planDays,
      paymentId: result.paymentId,
      gatewayPaymentId: paymentId,
      utr,
      alreadyConfirmed: result.alreadyConfirmed === true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment verification failed.'
    if (/not configured/i.test(message)) return jsonResponse({ error: message }, 503)
    console.error('Razorpay verification failed:', message)
    return jsonResponse({ error: 'Razorpay could not verify this payment right now. You can retry verification; your plan stays locked until confirmation.' }, 502)
  }
})
