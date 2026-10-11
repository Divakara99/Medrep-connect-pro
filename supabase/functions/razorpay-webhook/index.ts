import { createAdminClient } from '../_shared/supabase.ts'
import { jsonResponse } from '../_shared/http.ts'
import { constantTimeEqual, fetchRazorpayPayment, hmacSha256Hex } from '../_shared/razorpay.ts'

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, false)

  const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')?.trim()
  if (!webhookSecret) return jsonResponse({ error: 'Webhook is not configured.' }, 503, false)

  const signature = request.headers.get('x-razorpay-signature')?.trim().toLowerCase() ?? ''
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    return jsonResponse({ error: 'Invalid webhook signature.' }, 401, false)
  }

  const rawBody = await request.text()
  const expectedSignature = await hmacSha256Hex(webhookSecret, rawBody)
  if (!constantTimeEqual(expectedSignature, signature)) {
    return jsonResponse({ error: 'Invalid webhook signature.' }, 401, false)
  }

  let event: Record<string, unknown>
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: 'Invalid webhook payload.' }, 400, false)
  }

  // Only a captured event can activate an entitlement. Other signed events
  // (for example payment.failed) are acknowledged without granting a plan.
  if (event.event !== 'payment.captured') return jsonResponse({ ok: true, ignored: true }, 200, false)

  const payload = event.payload as Record<string, unknown> | undefined
  const paymentContainer = payload?.payment as Record<string, unknown> | undefined
  const paymentEntity = paymentContainer?.entity as Record<string, unknown> | undefined
  const orderId = typeof paymentEntity?.order_id === 'string' ? paymentEntity.order_id : ''
  const paymentId = typeof paymentEntity?.id === 'string' ? paymentEntity.id : ''
  if (!/^order_[A-Za-z0-9]+$/.test(orderId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
    return jsonResponse({ error: 'Captured payment details are missing.' }, 400, false)
  }

  try {
    const adminClient = createAdminClient()
    const { data: storedPayment, error: selectError } = await adminClient
      .from('subscription_payments')
      .select('id,amount_paise,currency,payment_status,razorpay_payment_id')
      .eq('razorpay_order_id', orderId)
      .maybeSingle()
    if (selectError) {
      console.error('Could not load the payment order for webhook:', selectError.message)
      return jsonResponse({ error: 'Payment record lookup failed.' }, 503, false)
    }
    if (!storedPayment) {
      // Razorpay retries non-2xx responses; this leaves room for the order
      // creation request to finish writing its server-side record.
      return jsonResponse({ error: 'Payment order is not recorded yet.' }, 503, false)
    }
    if (storedPayment.payment_status === 'paid') {
      if (storedPayment.razorpay_payment_id !== paymentId) {
        return jsonResponse({ error: 'Payment ID does not match the confirmed order.' }, 409, false)
      }
      return jsonResponse({ ok: true, alreadyConfirmed: true }, 200, false)
    }

    const payment = await fetchRazorpayPayment(paymentId)
    if (payment.entity !== 'payment'
      || payment.order_id !== orderId
      || payment.status !== 'captured'
      || payment.amount !== Number(storedPayment.amount_paise)
      || payment.currency !== storedPayment.currency) {
      console.error('Razorpay webhook payment did not match its stored plan order.')
      return jsonResponse({ error: 'Captured payment does not match the stored order.' }, 409, false)
    }

    const rawUtr = payment.acquirer_data?.rrn
    const utr = typeof rawUtr === 'string' || typeof rawUtr === 'number' ? String(rawUtr) : null
    const { data: confirmation, error: confirmError } = await adminClient.rpc(
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
      console.error('Verified webhook payment could not activate subscription:', confirmError.message)
      return jsonResponse({ error: 'Payment activation failed.' }, 500, false)
    }
    return jsonResponse({ ok: true, confirmation }, 200, false)
  } catch (error) {
    console.error('Razorpay webhook processing failed:', error instanceof Error ? error.message : error)
    return jsonResponse({ error: 'Webhook processing failed.' }, 500, false)
  }
})
