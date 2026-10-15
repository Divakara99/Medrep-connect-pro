import { authenticate, isResponse } from '../_shared/supabase.ts'
import { jsonResponse, readJson } from '../_shared/http.ts'
import { classifyPurchase, parseServiceAccount, PlayApi, purchaseTokenHash } from '../_shared/googleplay.ts'

/**
 * Verify a Google Play one-time ("N-day pass") purchase and activate the plan.
 *
 * The Razorpay flow's twin for the Android app:
 *   1. The caller is a signed-in Supabase user (JWT on).
 *   2. Google Play Developer API — not the device — confirms the purchase
 *      token, its product and its state, using the service-account secret.
 *   3. public.confirm_google_play_subscription_payment prices/dates the pass
 *      from public.billing_plans (via play_product_id), extends
 *      user_accounts.subscribed_until exactly like Razorpay, records the
 *      payment and is idempotent on the token hash.
 *   4. Only then is the purchase acknowledged and consumed (consumable pass,
 *      so it can be bought again as a renewal). Acknowledgement happens
 *      after — never before — server verification.
 *   5. Refunds/voids: a cancelled purchase re-presented here is routed to
 *      handle_google_play_voided_purchase, which marks it refunded and claws
 *      the days back only when this purchase is still the latest grant
 *      (otherwise it flags the row for review). Refunds the user never
 *      re-presents are reconciled by polling purchases.voidedpurchases with
 *      PlayApi.listVoided and calling the same SQL function — see ANDROID.md
 *      ("Refunds") for the scheduled-job recipe.
 */
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const context = await authenticate(request)
  if (isResponse(context)) return context

  const account = parseServiceAccount(Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'))
  if (!account) {
    return jsonResponse({ error: 'Google Play verification is not configured. Please contact support.' }, 503)
  }

  const body = await readJson(request)
  const planId = typeof body?.planId === 'string' ? body.planId.trim() : ''
  const productId = typeof body?.productId === 'string' ? body.productId.trim() : ''
  const purchaseToken = typeof body?.purchaseToken === 'string' ? body.purchaseToken.trim() : ''
  if (!planId || !productId || !purchaseToken) {
    return jsonResponse({ error: 'Purchase details are incomplete.' }, 400)
  }
  if (!/^[a-z0-9][a-z0-9_.-]{0,120}$/i.test(productId) || purchaseToken.length < 10 || purchaseToken.length > 4096) {
    return jsonResponse({ error: 'Purchase details are incomplete.' }, 400)
  }

  const tokenHash = await purchaseTokenHash(purchaseToken)

  try {
    const play = await PlayApi.create(account)
    const purchase = await play.getProductPurchase(productId, purchaseToken)
    const state = classifyPurchase(purchase)

    if (state === 'pending') {
      return jsonResponse({
        ok: false,
        activated: false,
        pending: true,
        message: 'Google Play has not completed this payment yet. Access starts as soon as Google confirms it.',
      }, 202)
    }
    if (state === 'cancelled' || state === 'unknown') {
      // Refunded / voided after grant, or never purchased: record the void
      // (no-op if unknown) and never activate.
      const { data: voidResult } = await context.adminClient.rpc('handle_google_play_voided_purchase', {
        p_purchase_token_hash: tokenHash,
        p_reason: state === 'cancelled' ? 'refunded' : 'voided',
      })
      const handled = (voidResult as { found?: boolean } | null)?.found === true
      return jsonResponse({
        error: handled
          ? 'This purchase was refunded by Google Play, so the pass has been closed.'
          : 'Google Play could not confirm this purchase.',
      }, 409)
    }
    if (purchase.orderId && typeof body?.orderId === 'string' && body.orderId.trim()
      && purchase.orderId !== body.orderId.trim()) {
      return jsonResponse({ error: 'Purchase details do not match. Please contact support.' }, 409)
    }

    const { data: confirmation, error: confirmError } = await context.adminClient.rpc(
      'confirm_google_play_subscription_payment',
      {
        p_user_id: context.user.id,
        p_plan_id: planId,
        p_play_product_id: productId,
        p_play_order_id: purchase.orderId ?? '',
        p_purchase_token_hash: tokenHash,
      },
    )
    if (confirmError) {
      console.error('Play purchase could not be applied:', confirmError.message)
      return jsonResponse({ error: 'The purchase is verified, but activation could not be completed. Please contact support with your Google Play order ID.' }, 500)
    }
    const result = (Array.isArray(confirmation) ? confirmation[0] : confirmation) as Record<string, unknown> | null
    if (!result || typeof result.expiresAt !== 'string') {
      return jsonResponse({ error: 'The purchase is verified, but activation could not be confirmed. Please contact support.' }, 500)
    }

    // Step 4: acknowledge, then consume (consuming also acknowledges). Only
    // failures AFTER activation are tolerated — the grant is safe and the
    // next app restore retries finalisation via the database flags.
    let acknowledged = purchase.acknowledgementState === 1
    let consumed = purchase.consumptionState === 1
    try {
      if (!consumed) {
        await play.consume(productId, purchaseToken)
        consumed = true
        acknowledged = true
      } else if (!acknowledged) {
        await play.acknowledge(productId, purchaseToken)
        acknowledged = true
      }
      await context.adminClient.rpc('mark_google_play_purchase_finalised', {
        p_purchase_token_hash: tokenHash,
        p_acknowledged: acknowledged,
        p_consumed: consumed,
      })
    } catch (finaliseError) {
      console.warn('Play finalisation will be retried:', finaliseError instanceof Error ? finaliseError.message : finaliseError)
    }

    return jsonResponse({
      ok: true,
      activated: true,
      expiresAt: result.expiresAt,
      planId: result.planId,
      planDays: result.planDays,
      paymentId: result.paymentId,
      orderId: purchase.orderId ?? null,
      alreadyConfirmed: result.alreadyConfirmed === true,
      acknowledged,
      consumed,
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Play verification failed.'
    if (/not configured|OAuth/i.test(message)) return jsonResponse({ error: 'Google Play verification is not configured. Please contact support.' }, 503)
    console.error('Google Play verification failed:', message)
    return jsonResponse({ error: 'Google Play could not verify this purchase right now. If you were charged, reopen the app to restore it.' }, 502)
  }
})
