import { useCallback, useEffect, useRef, useState } from 'react'
import { DEADZONE, THRESHOLD } from './pullToRefreshThreshold'

/**
 * Swipe-down-to-refresh for the installed app.
 *
 * The Android WebView has no pull-to-refresh of its own — a browser does it
 * natively. Inside the app the only way to re-read the job list was to leave the
 * screen, so a job that had just been unlocked with a rewarded video could look
 * locked until the next login.
 *
 * Two rules keep it from stealing ordinary scrolling:
 *
 *   1. It only arms when the page is genuinely at the top. `window.scrollY`
 *      alone is not enough: this document sets `overflow-x: hidden` on html and
 *      body and gives them `height: 100%`, so the element that actually scrolls
 *      is not always the window, and scrollY can sit at 0 while the user is
 *      halfway down the feed. That made every downward drag look like a pull.
 *   2. Nothing is hijacked until the finger has travelled past a deadzone, so a
 *      small downward nudge scrolls normally instead of starting a refresh.
 */
const MAX_PULL = 90

/** How far the page is really scrolled, from every element that can carry it. */
function scrollOffset(node: EventTarget | null): number {
  const candidates: number[] = [window.scrollY || 0]
  const scroller = document.scrollingElement as HTMLElement | null
  if (scroller) candidates.push(scroller.scrollTop)
  if (document.body) candidates.push(document.body.scrollTop)
  if (document.documentElement) candidates.push(document.documentElement.scrollTop)

  // Any scrollable ancestor of the touched node counts too — the drawer, a
  // modal body, or a card list that scrolls on its own.
  let element = (node as HTMLElement | null) ?? null
  if (element && element.nodeType !== Node.ELEMENT_NODE) {
    element = (element.parentElement as HTMLElement | null) ?? null
  }
  while (element && element !== document.documentElement) {
    if (element.scrollHeight > element.clientHeight + 1) candidates.push(element.scrollTop)
    element = element.parentElement
  }
  return Math.max(...candidates)
}

export function usePullToRefresh(onRefresh: () => Promise<void>, enabled: boolean) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const distance = useRef(0)
  const armed = useRef(false)

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

    function reset() {
      startY.current = null
      distance.current = 0
      armed.current = false
      setPull(0)
    }

    function onStart(event: TouchEvent) {
      if (refreshing || event.touches.length !== 1) return
      if (scrollOffset(event.target) > 0) {
        reset()
        return
      }
      startY.current = event.touches[0].clientY
      distance.current = 0
      armed.current = false
    }

    function onMove(event: TouchEvent) {
      if (startY.current === null || event.touches.length !== 1) return
      const travel = event.touches[0].clientY - startY.current

      // Upward (or sideways, or the page moved): not a pull.
      if (travel <= 0 || scrollOffset(event.target) > 0) {
        reset()
        return
      }
      // Below the deadzone the gesture is still ambiguous — let the page do
      // whatever it would normally do.
      if (!armed.current && travel < DEADZONE) return
      armed.current = true

      const resisted = Math.min((travel - DEADZONE) * 0.5, MAX_PULL)
      distance.current = resisted
      setPull(resisted)
      // Hold the page still now that this is definitely a pull; without it the
      // WebView rubber-bands and the gesture reads as a scroll.
      if (event.cancelable) event.preventDefault()
    }

    function onEnd() {
      const travelled = distance.current
      const wasArmed = armed.current
      reset()
      if (!wasArmed || travelled < THRESHOLD) return
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
