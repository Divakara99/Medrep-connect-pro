import { isNativeApp, isAndroidApp } from './platform'
import { triggerNativeBack } from './backstack'

/**
 * Android-app-only startup wiring, called once from main.tsx.
 *
 * On the website this is a no-op (the service worker registers as today).
 * In the app:
 *   - any previously registered service worker is unregistered and its
 *     caches dropped — the bundled build is updated by Play, never by sw.js,
 *     and a stale worker would strand users on an old bundle;
 *   - the Android back button is routed into the in-app back stack
 *     (innermost sheet/page first) instead of closing the app; on the first
 *     page the press is swallowed, matching the web guard behaviour.
 */
export function initNativeApp(): void {
  if (!isNativeApp()) return

  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
      .catch(() => undefined)
    if ('caches' in window) {
      void caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => undefined)
    }
  }

  if (isAndroidApp()) {
    void import('@capacitor/app')
      .then(({ App }) => App.addListener('backButton', () => { triggerNativeBack() }))
      .catch(() => undefined)
  }
}
