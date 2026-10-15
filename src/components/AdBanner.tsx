import { useEffect } from 'react'
import { hideBanner, showBanner } from '../data/ads'
import { isAndroidApp } from '../data/platform'

/**
 * Adaptive AdMob banner for content screens (Android app only).
 *
 * The banner itself is a native overlay pinned to the bottom of the screen;
 * this component only reserves space for it and drives show/hide as screens
 * mount/unmount. It renders nothing on the website, and the caller decides
 * where banners are allowed (never on login/sign-up/password/payment
 * screens — see bannerAllowedOnTab in adConfig.ts). Both free and
 * subscribed users see the banner; subscribers never see rewarded videos.
 */
export function AdBanner({ enabled, bottomMargin = 0 }: { enabled: boolean; bottomMargin?: number }) {
  const active = enabled && isAndroidApp()

  useEffect(() => {
    if (!active) return
    void showBanner(bottomMargin)
    return () => { void hideBanner() }
  }, [active, bottomMargin])

  if (!active) return null
  return <div aria-hidden className="h-16 shrink-0" data-ad-banner-spacer style={{ marginBottom: bottomMargin }} />
}
