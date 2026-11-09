import { authenticate, isResponse, optionsResponse } from '../_shared/supabase.ts'
import { jsonResponse, readJson } from '../_shared/http.ts'
import { createRazorpayOrder, razorpayCredentials } from '../_shared/razorpay.ts'

/**
 * Price of one job's full contact details for one hour, in paise.
 *
 * ₹5 is decided HERE, on the server, and nowhere else. The browser cannot send
 * an amount, so it cannot buy an hour for less. The same number is repeated in
 * supabase/job_unlocks.sql (CHECK amount_paise = 500) and in the app, which only
 * uses it for the label.
 */
const JOB_UNLOCK_PRICE_PAISE = 500

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const context = await authenticate(request)
  if (isResponse(context)) return context

  const body = await readJson(request)
  const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : ''
  if (!jobId || jobId.length > 100) return jsonResponse({ error: 'Choose a job to unlock.' }, 400)

  // The job must exist and must not be a deleted tombstone: paying for the
  // contact of a vacancy that was taken down would be a refund.
  const { data: vacancy, error: vacancyError } = await context.adminClient
    .from('vacancies')
    .select('id,data')
    .eq('id', jobId)
    .maybeSingle()
  if (vacancyError) {
    console.error('Could not read the vacancy for a job unlock:', vacancyError.code ?? 'unavailable')
    return jsonResponse({ error: 'Vacancies are unavailable right now. Please try again later.' }, 503)
  }
  const data = (vacancy?.data ?? null) as Record<string, unknown> | null
  if (!vacancy || !data || data.deleted === true || data.deleted === 'true') {
    return jsonResponse({ error: 'This vacancy is no longer open, so there is nothing to unlock.' }, 404)
  }
  const jobTitle = typeof data.title === 'string' ? data.title.slice(0, 120) : 'Vacancy'

  try {
    const { keyId } = razorpayCredentials()
    const recordId = crypto.randomUUID()
    const order = await createRazorpayOrder({
      amountPaise: JOB_UNLOCK_PRICE_PAISE,
      currency: 'INR',
      receipt: `mrc_job_${crypto.randomUUID().replaceAll('-', '')}`,
      notes: {
        user_id: context.user.id,
        job_id: jobId,
        unlock: 'job_contact_1h',
        payment_record_id: recordId,
      },
    })

    // A pending row is the only memory of the order. It reveals nothing:
    // list_visible_jobs() needs payment_status = 'paid' AND expires_at > now().
    const { error: insertError } = await context.adminClient
      .from('job_unlocks')
      .insert({
        id: recordId,
        user_id: context.user.id,
        job_id: jobId,
        amount_paise: JOB_UNLOCK_PRICE_PAISE,
        razorpay_order_id: order.id,
        payment_status: 'pending',
      })
    if (insertError) {
      console.error('Failed to store a pending job unlock:', { dbErrorCode: insertError.code ?? 'unavailable' })
      return jsonResponse({ error: 'The unlock order could not be recorded. Please contact support before retrying.' }, 500)
    }

    return jsonResponse({
      ok: true,
      jobId,
      jobTitle,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
      minutes: 60,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment service is unavailable.'
    const status = /not configured/i.test(message) ? 503 : 502
    console.error('Job unlock order creation failed:', message)
    return jsonResponse(
      { error: status === 503 ? message : 'Checkout could not start. Please try again in a moment.' },
      status,
    )
  }
})
