import { useCallback, useEffect, useRef, useState } from 'react'
import { THRESHOLD } from './pullToRefreshThreshold'

/**
 * Swipe-down-to-refresh for the installed app.
 *
 * The Android WebView has no pull-to-refresh of its own — a browser does it
 * natively. Inside the app the only way to re-read the job list was to leave the
 * screen, so a job that had just been unlocked with a rewarded video could look
 * locked until the next login.
 *
 * The gesture only engages when the page is already scrolled to the very top, so
 * it never fights normal scrolling, and it is deliberately resisted (half the
 * finger's travel) so it feels like a rubber band rather than a jump.
 */
const MAX_PULL = 90

export function usePullToRefresh(onRefresh: () => Promise<void>, enabled: boolean) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const distance = useRef(0)

  const run = useCallback(async () => {
    setRefreshing(true)
    setPull(36)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
      setPull(0)
    }
  }, [onRefresh])

  useEffect(() => {
    if (!enabled) return
    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0

    function onStart(event: TouchEvent) {
      if (refreshing || event.touches.length !== 1) return
      if (!atTop()) return
      startY.current = event.touches[0].clientY
      distance.current = 0
    }

    function onMove(event: TouchEvent) {
      if (startY.current === null || event.touches.length !== 1) return
      const travel = event.touches[0].clientY - startY.current
      if (travel <= 0 || !atTop()) {
        startY.current = null
        distance.current = 0
        setPull(0)
        return
      }
      const resisted = Math.min(travel * 0.5, MAX_PULL)
      distance.current = resisted
      setPull(resisted)
      // Hold the page still while the indicator is being dragged out; without
      // this the WebView rubber-bands and the gesture reads as a scroll.
      if (event.cancelable) event.preventDefault()
    }

    function onEnd() {
      const travelled = distance.current
      startY.current = null
      distance.current = 0
      if (travelled < THRESHOLD) {
        setPull(0)
        return
      }
      void run()
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled, refreshing, run])

  return { pull, refreshing }
}
