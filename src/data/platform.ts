import { Capacitor } from '@capacitor/core'

/**
 * One place decides "are we inside the Android app?".
 *
 * Every Android-only behaviour (AdMob ads, Google Play Billing, no service
 * worker, no web-push UI, hidden Razorpay/UPI) is gated on these helpers, so
 * the website at medrepconnect.in keeps behaving exactly as it did on
 * medrepjob.netlify.app: Razorpay/UPI checkout, service worker, web push, no ads.
 */

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export function isAndroidApp(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  } catch {
    return false
  }
}

/** Ads and Play Billing ship on Android only (no iOS build in this release). */
export const adsEnabled = isAndroidApp
export const playBillingEnabled = isAndroidApp

/**
 * Password-reset links opened from an email must land on a real web origin:
 * inside the app `window.location.origin` is `https://localhost`, which
 * Supabase would reject / strand the user on. On the web the current page
 * stays the redirect target, as before.
 */
export const WEB_APP_ORIGIN = 'https://medrepconnect.in'

export function passwordResetRedirectTo(): string {
  if (isNativeApp()) return `${WEB_APP_ORIGIN}/`
  return `${window.location.origin}${window.location.pathname}${window.location.search}`
}
