import { authenticate, isResponse, optionsResponse } from '../_shared/supabase.ts'
import { jsonResponse, isUuid, readJson } from '../_shared/http.ts'

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const context = await authenticate(request)
  if (isResponse(context)) return context

  const body = await readJson(request)
  const paymentRecordId = body?.paymentRecordId
  const utr = typeof body?.utr === 'string' ? body.utr.trim() : ''
  if (!isUuid(paymentRecordId) || !/^[a-zA-Z0-9-]{6,35}$/.test(utr)) {
    return jsonResponse({ error: 'Enter the UTR/reference shown by your UPI app after payment.' }, 400)
  }

  const { data: payment, error: lookupError } = await context.adminClient
    .from('subscription_payments')
    .select('id,payment_status,payment_method,utr')
    .eq('id', paymentRecordId)
    .eq('user_id', context.user.id)
    .maybeSingle()
  if (lookupError) {
    console.error('Could not load the manual UPI request:', lookupError.message)
    return jsonResponse({ error: 'Payment records are not configured. Contact support.' }, 503)
  }
  if (!payment || payment.payment_method !== 'upi_manual') {
    return jsonResponse({ error: 'This UPI request does not belong to your account.' }, 404)
  }
  if (payment.payment_status === 'manual_review' && payment.utr?.toLowerCase() === utr.toLowerCase()) {
    return jsonResponse({ ok: true, pendingVerification: true, alreadySubmitted: true })
  }
  if (payment.payment_status !== 'pending') {
    return jsonResponse({ error: 'This UPI request can no longer be changed.' }, 409)
  }

  const { data: updatedPayment, error: updateError } = await context.adminClient
    .from('subscription_payments')
    .update({ payment_status: 'manual_review', utr })
    .eq('id', paymentRecordId)
    .eq('user_id', context.user.id)
    .eq('payment_method', 'upi_manual')
    .eq('payment_status', 'pending')
    .select('id')
    .maybeSingle()
  if (updateError) {
    const message = /subscription_payments_utr_unique/i.test(updateError.message)
      ? 'That UTR has already been submitted. Check the reference and contact support if this is a mistake.'
      : 'The UTR could not be submitted. Please try again.'
    return jsonResponse({ error: message }, 409)
  }
  if (!updatedPayment) return jsonResponse({ error: 'This UPI request was already submitted or is no longer pending.' }, 409)

  // A typed UTR is only a reference for admin reconciliation. It is never
  // proof of payment and cannot activate the subscription by itself.
  return jsonResponse({ ok: true, pendingVerification: true, activated: false })
})
