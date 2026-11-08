import { authenticate, isResponse, optionsResponse } from '../_shared/supabase.ts'
import { jsonResponse, readJson } from '../_shared/http.ts'
import { captureRazorpayPayment, fetchRazorpayPayment, verifyCheckoutSignature } from '../_shared/razorpay.ts'

/**
 * Verifies one ₹5 job unlock and starts its 1-hour window.
 *
 * Nothing the browser says is trusted: the order must belong to this user, the
 * amount in the pending row is 500 paise, Razorpay must confirm that exact
 * amount on that exact order, and the payment must be captured. The window is
 * stamped by the server. Replaying the same payment returns the same row
 * instead of buying a second hour.
 */
const JOB_UNLOCK_PRICE_PAISE = 500
const JOB_UNLOCK_MINUTES = 60

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

  const { data: stored, error: selectError } = await context.adminClient
    .from('job_unlocks')
    .select('id,user_id,job_id,amount_paise,payment_status,razorpay_payment_id,expires_at')
    .eq('razorpay_order_id', orderId)
    .eq('user_id', context.user.id)
    .maybeSingle()
  if (selectError) {
    console.error('Could not load the job unlock order:', selectError.code ?? 'unavailable')
    return jsonResponse({ error: 'Unlock payments are not configured. Contact support.' }, 503)
  }
  if (!stored) return jsonResponse({ error: 'This unlock order does not belong to your account.' }, 404)

  if (stored.payment_status === 'paid') {
    if (stored.razorpay_payment_id !== paymentId) {
      return jsonResponse({ error: 'This order was already confirmed by a different payment.' }, 409)
    }
    return jsonResponse({
      ok: true,
      jobId: stored.job_id,
      expiresAt: stored.expires_at,
      alreadyConfirmed: true,
    })
  }
  if (stored.payment_status !== 'pending') {
    return jsonResponse({ error: 'This unlock order is no longer pending.' }, 409)
  }
  if (stored.amount_paise !== JOB_UNLOCK_PRICE_PAISE) {
    console.error('A job unlock order carried an unexpected amount.')
    return jsonResponse({ error: 'This unlock order is mispriced. Contact support before paying.' }, 409)
  }

  const secret = Deno.env.get('RAZORPAY_KEY_SECRET')?.trim()
  if (!secret) return jsonResponse({ error: 'Razorpay server verification is not configured.' }, 503)

  try {
    const validSignature = await verifyCheckoutSignature(secret, orderId, paymentId, signature)
    if (!validSignature) return jsonResponse({ error: 'Razorpay payment signature is invalid.' }, 403)

    let payment = await fetchRazorpayPayment(paymentId)
    if (payment.entity !== 'payment'
      || payment.order_id !== orderId
      || payment.amount !== JOB_UNLOCK_PRICE_PAISE
      || payment.currency !== 'INR') {
      return jsonResponse({ error: 'Razorpay payment details do not match this ₹5 unlock.' }, 409)
    }

    if (payment.status === 'authorized') {
      try {
        await captureRazorpayPayment(paymentId, JOB_UNLOCK_PRICE_PAISE)
      } catch (captureError) {
        console.warn('Razorpay capture is not complete yet:', captureError instanceof Error ? captureError.message : captureError)
      }
      payment = await fetchRazorpayPayment(paymentId)
    }

    if (payment.status !== 'captured') {
      return jsonResponse({
        ok: false,
        paymentStatus: payment.status,
        message: 'Razorpay has not captured this payment yet. The unlock starts only after capture is verified.',
      }, 202)
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + JOB_UNLOCK_MINUTES * 60_000).toISOString()
    // Only a still-pending row can be paid, and only once: the UNIQUE
    // razorpay_payment_id constraint backs this up at the database level.
    const { data: updated, error: updateError } = await context.adminClient
      .from('job_unlocks')
      .update({
        razorpay_payment_id: paymentId,
        payment_status: 'paid',
        paid_at: now.toISOString(),
        expires_at: expiresAt,
      })
      .eq('razorpay_order_id', orderId)
      .eq('user_id', context.user.id)
      .eq('payment_status', 'pending')
      .select('job_id,expires_at')
      .maybeSingle()

    if (updateError) {
      console.error('Verified job unlock could not be applied:', updateError.code ?? 'unavailable')
      return jsonResponse({ error: 'Payment is verified, but the unlock could not start. Contact support with your Razorpay payment ID.' }, 500)
    }

    if (!updated) {
      // A concurrent confirmation won the race; report its window rather than
      // starting a second hour.
      const { data: current } = await context.adminClient
        .from('job_unlocks')
        .select('job_id,expires_at,razorpay_payment_id')
        .eq('razorpay_order_id', orderId)
        .eq('user_id', context.user.id)
        .maybeSingle()
      if (current?.razorpay_payment_id === paymentId) {
        return jsonResponse({ ok: true, jobId: current.job_id, expiresAt: current.expires_at, alreadyConfirmed: true })
      }
      return jsonResponse({ error: 'This unlock was already confirmed. Reopen the job to see it.' }, 409)
    }

    return jsonResponse({
      ok: true,
      jobId: updated.job_id,
      expiresAt: updated.expires_at,
      minutes: JOB_UNLOCK_MINUTES,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment verification failed.'
    console.error('Job unlock verification failed:', message)
    return jsonResponse({ error: 'The payment could not be verified yet. If money left your account, contact support with the Razorpay payment ID.' }, 502)
  }
})
