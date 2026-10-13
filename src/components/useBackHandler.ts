import { useEffect, useRef } from 'react'
import { pushBackHandler } from '../data/backstack'

/**
 * Changes the phone's back button into an in-app step back while `active`.
 *
 * `onBack` should close the sheet / leave the page that is currently on top.
 * Handlers run newest-first, so a sheet opened over a page closes before the
 * page itself steps back; the app never leaves the phone's back button.
 */
export function useBackHandler(active: boolean, onBack: () => void): void {
  // Keep the newest callback without re-registering on every render.
  const latest = useRef(onBack)
  useEffect(() => { latest.current = onBack }, [onBack])

  useEffect(() => {
    if (!active) return
    return pushBackHandler(() => { latest.current() })
  }, [active])
}
