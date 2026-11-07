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
export function AdBanner({ enabled }: { enabled: boolean }) {
  const active = enabled && isAndroidApp()

  useEffect(() => {
    if (!active) return
    void showBanner()
    return () => { void hideBanner() }
  }, [active])

  if (!active) return null
  // The spacer is what keeps the end of a page (the creator credit, the last
  // job card, any footer line) clear of the banner. A fixed 4rem was shorter
  // than the banner actually is on a tablet — adaptive banners grow with the
  // screen width up to 90 dp — so the footer sat half under the ad. --ad-reserve
  // is the measured-ish height for this viewport (see adConfig.ts), with half a
  // rem of breathing room so the last line never touches the ad edge.
  return (
    <div
      aria-hidden
      data-ad-banner-spacer
      className="shrink-0"
      style={{ height: 'calc(var(--ad-reserve, 4rem) + 0.5rem)' }}
    />
  )
}
