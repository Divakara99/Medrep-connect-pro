import { fetchVerifierKeys, parseSsvParams, signedContent, verifySsvCallback } from '../_shared/admob.ts'
import { createAdminClient } from '../_shared/supabase.ts'

/**
 * AdMob rewarded server-side verification (SSV) callback.
 *
 * Google — not the phone — calls this GET endpoint when a rewarded video
 * completes. It is the ONLY way a company-name unlock is granted:
 *
 *   1. `verify_jwt` is OFF for this function (supabase/config.toml): Google
 *      carries no Supabase JWT. Security comes from Google's ECDSA signature,
 *      verified against https://www.gstatic.com/admob/reward/verifier-keys.json
 *   2. The ad unit must be the configured rewarded unit.
 *   3. user_id must be a Supabase user id and custom_data the job id — the
 *      pair the app passes via the plugin's SSV options.
 *   4. transaction_id de-duplication is the UNIQUE constraint on
 *      public.company_unlocks, so a replayed callback grants nothing twice.
 *   5. The row is written with the service role; users can only read their own.
 *
 * Google expects HTTP 200 for a verified callback; anything else makes it
 * retry, which is safe here because of the uniqueness guarantees.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'GET') return text('Method not allowed.', 405)

  const expectedAdUnit = Deno.env.get('ADMOB_REWARDED_AD_UNIT_ID')?.trim()
  if (!expectedAdUnit) {
    console.error('ADMOB_REWARDED_AD_UNIT_ID is not configured.')
    return text('Server verification is not configured.', 503)
  }

  const url = new URL(request.url)
  const params = parseSsvParams(url)
  if (!params) return text('Missing SSV parameters.', 400)

  const content = signedContent(url)
  if (!content) return text('Missing signature.', 400)

  let verified = false
  try {
    const keys = await fetchVerifierKeys()
    verified = await verifySsvCallback({ keys, keyId: params.keyId, signature: params.signature, content })
  } catch (cause) {
    console.error('Verifier keys failed:', cause instanceof Error ? cause.message : cause)
    return text('Verification is temporarily unavailable.', 503)
  }
  if (!verified) return text('Invalid signature.', 403)

  // AdMob console "Verify URL" probe: Google signs a synthetic callback with
  // the dummy ad unit 1234567890. Only Google can produce that signature, so
  // acknowledge the probe — but grant nothing for it.
  if (params.adUnit === '1234567890') return text('Verification OK.', 200)

  // Google sends ad_unit either as the full "ca-app-pub-…/…" id or as the
  // bare numeric unit id; accept exactly our unit in either form.
  const expectedNumericUnit = expectedAdUnit.split('/').pop() ?? ''
  if (params.adUnit !== expectedAdUnit && params.adUnit !== expectedNumericUnit) {
    console.error('Ad unit mismatch: received', params.adUnit, 'expected', expectedAdUnit)
    return text('Unknown ad unit.', 400)
  }
  if (!UUID_PATTERN.test(params.userId)) return text('Invalid user.', 400)
  if (!params.customData || params.customData.length > 200) return text('Invalid job.', 400)

  let adminClient
  try {
    adminClient = createAdminClient()
  } catch {
    return text('Server is not configured.', 503)
  }

  // The job must be a live vacancy — a forged-but-signed payload can only
  // name ids Google itself was handed, but stay strict anyway.
  const { data: vacancy, error: vacancyError } = await adminClient
    .from('vacancies')
    .select('id,data')
    .eq('id', params.customData)
    .maybeSingle()
  if (vacancyError) {
    console.error('Vacancy lookup failed:', vacancyError.message)
    return text('Unlock could not be recorded.', 503)
  }
  const vacancyData = (vacancy as { data?: { deleted?: unknown } } | null)?.data
  if (!vacancy || vacancyData?.deleted === true) return text('Unknown job.', 404)

  const { error: insertError } = await adminClient
    .from('company_unlocks')
    .insert({
      user_id: params.userId,
      job_id: params.customData,
      transaction_id: params.transactionId,
      ad_unit_id: params.adUnit,
      reward_amount: Number.parseInt(params.rewardAmount, 10) || null,
      reward_item: params.rewardItem || null,
    })
  if (insertError) {
    // 23505 = duplicate transaction (Google retry) or user already unlocked
    // this job: both are successful no-ops from Google's perspective.
    if ((insertError as { code?: string }).code === '23505') return text('Already recorded.', 200)
    console.error('Unlock insert failed:', insertError.message)
    return text('Unlock could not be recorded.', 503)
  }

  return text('Unlock recorded.', 200)
})
