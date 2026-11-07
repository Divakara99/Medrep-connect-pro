import { useEffect } from 'react'
import { hideBanner, showBanner } from '../data/ads'
import { isAndroidApp } from '../data/platform'

/**
 * Adaptive AdMob banner for content screens (Android app only).
 *
 * The banner itself is a native overlay pinned to the bottom of the screen, so
 * this component only drives show/hide as screens mount and unmount. The space
 * it covers is reserved once, on the app shell, by --ad-reserve (App.tsx) —
 * that way every page, footer and sheet in the app gives way to it, not just
 * the screen that happened to render a spacer. It renders nothing on the
 * website, and the caller decides where banners are allowed (never on
 * login/sign-up/password/payment screens — see bannerAllowedOnTab in
 * adConfig.ts). Both free and subscribed users see the banner; subscribers
 * never see rewarded videos.
 */
export function AdBanner({ enabled }: { enabled: boolean }) {
  const active = enabled && isAndroidApp()

  useEffect(() => {
    if (!active) return
    void showBanner()
    return () => { void hideBanner() }
  }, [active])

  // Nothing to draw: the space is reserved once, on the app shell, by
  // --ad-reserve. A spacer inside the page could only cover the page that
  // rendered it, and a fixed one was shorter than the banner on a tablet.
  return null
}
