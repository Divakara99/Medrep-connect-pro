import type { CapacitorConfig } from '@capacitor/cli'

/**
 * MedRep Pro — the Android app (Google Play).
 *
 * The website is a separate build of the same code and is NOT affected by
 * this file: Netlify keeps serving Razorpay/UPI with no ads. Everything
 * Android-only in the app is gated at runtime on `isNativeApp()`
 * (src/data/platform.ts), so the web bundle behaves exactly as before.
 *
 * The web build is bundled into the APK/AAB (no remote `server.url`), so the
 * app works offline-capable and Play review sees the real app.
 */
const config: CapacitorConfig = {
  appId: 'in.medrepconnect.app',
  appName: 'MedRep Pro',
  webDir: 'dist',
  android: {
    // Keep the WebView background white so there is no dark flash on launch.
    backgroundColor: '#ffffff',
    // External links (mailto/WhatsApp/maps) must leave the app; never trap
    // them inside the WebView.
    allowMixedContent: false,
  },
  plugins: {
    NativePurchases: {
      // Purchases are acknowledged/consumed ONLY by the
      // verify-google-play-purchase Edge Function after server verification.
      // Letting the plugin auto-finish would acknowledge a purchase before
      // Google (and our database) have confirmed it.
      autoFinishTransactions: false,
    },
  },
}

export default config
