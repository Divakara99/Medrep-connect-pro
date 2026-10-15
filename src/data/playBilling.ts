import { isAndroidApp } from './platform'
import { supabase } from './supabase'
import type { Plan } from './plans'

/**
 * Google Play Billing (Android app only), via @capgo/native-purchases
 * (Play Billing Library 9).
 *
 * Flow, mirroring the Razorpay guarantees:
 *   1. Play charges the user for the plan's one-time "N-day pass" product.
 *   2. The purchase token goes to the verify-google-play-purchase Edge
 *      Function, which checks it against the Google Play Developer API,
 *      prices/dates it from public.billing_plans (never from the device),
 *      extends subscribed_until exactly like the Razorpay flow, records the
 *      payment idempotently, and only then acknowledges + consumes it.
 *   3. The app refreshes the server subscription. A success toast in the app
 *      never activates anything by itself.
 *
 * The plugin is imported lazily so the website never loads billing code.
 * `autoFinishTransactions` is disabled in capacitor.config.ts, so nothing is
 * acknowledged before the server has verified the token.
 */

export type PlayProductPrice = { productId: string; price: string }

type NativePurchasesPlugin = typeof import('@capgo/native-purchases').NativePurchases

let pluginPromise: Promise<NativePurchasesPlugin | null> | null = null

async function loadPlugin(): Promise<NativePurchasesPlugin | null> {
  if (!isAndroidApp()) return null
  pluginPromise ??= import('@capgo/native-purchases')
    .then((module) => module.NativePurchases)
    .catch(() => null)
  return pluginPromise
}

/** Localised Play prices for the plans that have a Play product, keyed by plan id. */
export async function loadPlayPrices(plans: Plan[]): Promise<Map<string, string>> {
  const prices = new Map<string, string>()
  const NativePurchases = await loadPlugin()
  if (!NativePurchases) return prices
  const withProducts = plans.filter((plan) => plan.playProductId)
  if (withProducts.length === 0) return prices
  try {
    const { PURCHASE_TYPE } = await import('@capgo/native-purchases')
    const { products } = await NativePurchases.getProducts({
      productIdentifiers: withProducts.map((plan) => plan.playProductId as string),
      productType: PURCHASE_TYPE.INAPP,
    })
    for (const product of products) {
      const plan = withProducts.find((candidate) => candidate.playProductId === product.identifier)
      if (plan && product.priceString) prices.set(plan.id, product.priceString)
    }
  } catch {
    // The catalog ₹ price stays on screen; checkout reports real errors.
  }
  return prices
}

export type PlayPurchaseOutcome =
  | { ok: true; expiresAt?: string }
  | { ok: false; error: string; pending?: boolean }

async function invokeVerify(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('verify-google-play-purchase', { body })
  if (error) {
    const context = (error as Error & { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { error?: string }
        if (payload.error) throw new Error(payload.error)
      } catch (cause) {
        if (cause instanceof Error && cause.message && !(cause instanceof SyntaxError)) throw cause
      }
    }
    throw new Error(error.message || 'Play purchase verification is unavailable.')
  }
  if (!data || typeof data !== 'object') throw new Error('Play purchase verification returned no response.')
  if (typeof (data as { error?: unknown }).error === 'string') {
    throw new Error((data as { error: string }).error)
  }
  return data as Record<string, unknown>
}

/**
 * Buy `plan` through Google Play and activate it server-side.
 * Consumable one-time passes: the server consumes the token after granting,
 * so the same pass can be bought again (renewal) later.
 */
export async function buyPlanWithGooglePlay(plan: Plan, appAccountToken?: string): Promise<PlayPurchaseOutcome> {
  const NativePurchases = await loadPlugin()
  if (!NativePurchases) return { ok: false, error: 'Google Play Billing is available in the Android app only.' }
  if (!plan.playProductId) {
    return { ok: false, error: 'This plan is not available on Google Play yet. Please try another plan or contact support.' }
  }
  try {
    const { PURCHASE_TYPE } = await import('@capgo/native-purchases')
    const supported = await NativePurchases.isBillingSupported()
    if (!supported.isBillingSupported) {
      return { ok: false, error: 'Google Play Billing is not available on this device.' }
    }
    const transaction = await NativePurchases.purchaseProduct({
      productIdentifier: plan.playProductId,
      productType: PURCHASE_TYPE.INAPP,
      isConsumable: true,
      autoAcknowledgePurchases: false,
      ...(appAccountToken ? { appAccountToken } : {}),
    })
    if (transaction.purchaseState && transaction.purchaseState !== '1') {
      return { ok: false, pending: true, error: 'Your payment is pending in Google Play. Access starts once Google confirms it — reopen the app to finish.' }
    }
    const purchaseToken = transaction.purchaseToken
    if (!purchaseToken) return { ok: false, error: 'Google Play did not return a purchase token. If you were charged, reopen the app to restore.' }

    const result = await invokeVerify({
      planId: plan.id,
      productId: plan.playProductId,
      purchaseToken,
      orderId: transaction.transactionId,
    })
    if (result.ok !== true) {
      return { ok: false, error: typeof result.message === 'string' ? result.message : 'The purchase could not be verified yet.' }
    }
    return { ok: true, expiresAt: typeof result.expiresAt === 'string' ? result.expiresAt : undefined }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Google Play purchase failed.'
    if (/cancel/i.test(message)) return { ok: false, error: 'Purchase cancelled — nothing was charged.' }
    return { ok: false, error: message }
  }
}

/**
 * Re-verify any purchase Play still holds for this device (app reopened
 * after a pending/interrupted purchase). Already-consumed passes are gone
 * from Play by design, so this only finds un-consumed ones.
 */
export async function restorePlayPurchases(plans: Plan[]): Promise<{ restored: number }> {
  const NativePurchases = await loadPlugin()
  if (!NativePurchases) return { restored: 0 }
  try {
    const { PURCHASE_TYPE } = await import('@capgo/native-purchases')
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP })
    let restored = 0
    for (const purchase of purchases ?? []) {
      if (!purchase.purchaseToken || (purchase.purchaseState && purchase.purchaseState !== '1')) continue
      const plan = plans.find((candidate) => candidate.playProductId === purchase.productIdentifier)
      if (!plan?.playProductId) continue
      try {
        const result = await invokeVerify({
          planId: plan.id,
          productId: plan.playProductId,
          purchaseToken: purchase.purchaseToken,
          orderId: purchase.transactionId,
        })
        if (result.ok === true) restored += 1
      } catch {
        // Leave the token for the next restore attempt.
      }
    }
    return { restored }
  } catch {
    return { restored: 0 }
  }
}
