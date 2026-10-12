import { authenticate, isResponse, optionsResponse } from '../_shared/supabase.ts'
import { isAdmin, isUuid, jsonResponse, readJson } from '../_shared/http.ts'

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const context = await authenticate(request)
  if (isResponse(context)) return context
  // Trusted admin role AND a verified authenticator (aal2) session.
  if (!isAdmin(context.user.app_metadata)) {
    return jsonResponse({ error: 'An administrator account is required.' }, 403)
  }
  if (!context.aal2) {
    return jsonResponse({ error: 'Verify your authenticator code (MFA) before reviewing payments.' }, 403)
  }

  const body = await readJson(request)
  const paymentRecordId = body?.paymentRecordId
  const approve = body?.approve
  if (!isUuid(paymentRecordId) || typeof approve !== 'boolean') {
    return jsonResponse({ error: 'A payment ID and review decision are required.' }, 400)
  }

  const { data, error } = await context.adminClient.rpc('review_manual_upi_subscription_payment', {
    p_payment_id: paymentRecordId,
    p_reviewer_id: context.user.id,
    p_approve: approve,
  })
  if (error) {
    console.error('Manual UPI review failed:', error.message)
    return jsonResponse({ error: 'This payment could not be reviewed. Refresh and try again.' }, 409)
  }

  const result = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return jsonResponse({ ok: true, ...result })
})
