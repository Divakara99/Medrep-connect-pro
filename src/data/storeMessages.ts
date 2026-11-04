/**
 * What to tell a user when Google Play or AdMob says no.
 *
 * While store products (one-time passes) and the AdMob app are in review, or on
 * a device with no Play access, the plugins surface raw codes —
 * "ITEM_UNAVAILABLE", "BILLING_UNAVAILABLE", "no fill". Those are meaningless
 * on a phone, and "check your connection" is wrong advice for a product that is
 * simply not live yet. These pure mappers turn the codes into one sentence the
 * user (and support) can act on.
 */

export type MappedError = { message: string; retryable: boolean }

const has = (text: string, ...needles: string[]) =>
  needles.some((needle) => text.includes(needle))

/** Google Play Billing failure → a sentence for the checkout sheet. */
export function billingErrorMessage(raw: unknown): MappedError {
  const text = String(raw instanceof Error ? raw.message : raw ?? '').toLowerCase()
  if (!text) {
    return { message: 'Google Play could not complete this purchase. Please try again.', retryable: true }
  }
  if (has(text, 'cancel')) {
    return { message: 'Purchase cancelled — nothing was charged.', retryable: true }
  }
  // Products exist but Google has not finished reviewing them, or the build does
  // not carry them yet. A retry in a minute will not help; a retry later will.
  if (has(text, 'item_unavailable', 'item is unavailable', 'item not found', 'no sku', 'sku_details', 'not available on google play')) {
    return {
      message: 'This pass is not on sale yet — Google Play is still reviewing it. Please try again in a few hours. You have not been charged.',
      retryable: false,
    }
  }
  if (has(text, 'billing_unavailable', 'feature_not_supported', 'play store')) {
    return {
      message: 'Google Play Billing is not available on this device right now. Update the Play Store app, then try again.',
      retryable: true,
    }
  }
  if (has(text, 'item_already_owned', 'already owned')) {
    return { message: 'You already own this pass. Reopen the app and it will be restored to your account.', retryable: false }
  }
  if (has(text, 'service_disconnected', 'network', 'timeout', 'timed out', 'unreach')) {
    return { message: 'Google Play could not be reached. Check your connection and try again.', retryable: true }
  }
  if (has(text, 'developer_error', 'invalid')) {
    return {
      message: 'Google Play rejected the purchase request. Please try again; if it keeps happening, email support and we will check the product setup.',
      retryable: false,
    }
  }
  return { message: 'Google Play could not complete this purchase. Please try again.', retryable: true }
}

/** AdMob rewarded-video failure → a sentence for the job card. */
export function rewardedErrorMessage(raw: unknown): MappedError {
  const text = String(raw instanceof Error ? raw.message : raw ?? '').toLowerCase()
  if (!text) {
    return { message: 'The video could not be played. Please try again in a moment.', retryable: true }
  }
  // AdMob returns no fill until the app is linked to the store listing and has
  // been reviewed; there is simply nothing to play.
  if (has(text, 'no fill', 'no ad', 'no inventory', 'ad_not_loaded', 'not loaded', 'load failed', 'failed to load')) {
    return {
      message: 'No video is available for this job right now. Please try again in a few minutes — the company name stays free.',
      retryable: true,
    }
  }
  if (has(text, 'network', 'offline', 'timeout', 'timed out', 'unreach')) {
    return { message: 'The video needs a connection. Check your internet and try again.', retryable: true }
  }
  if (has(text, 'android app only')) {
    return { message: 'Unlock videos are available in the Android app only.', retryable: false }
  }
  return { message: 'The video could not be played. Please try again in a moment.', retryable: true }
}
