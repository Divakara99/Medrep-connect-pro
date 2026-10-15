/**
 * In-app back navigation for phones and installed PWAs.
 *
 * A back gesture pops one session-history entry. With a single entry the app is
 * closed; this module keeps one guard entry on top of the history and routes
 * every back gesture to the innermost screen the app has open:
 *
 *   1. the newest registered screen — an open sheet/dialog, or the applications
 *      page shown over Account,
 *   2. then the page stack the app keeps itself (App steps back to the previous
 *      tab),
 *   3. and on the first page the gesture is swallowed, so the app stays open
 *      instead of closing.
 *
 * The guard entry is re-armed after every handled gesture, so each back press is
 * exactly one step inside the app.
 */

type BackHandler = () => void

const handlers: BackHandler[] = []
let installed = false

/** Marker written on the history entry this module owns. */
export const BACK_GUARD_KEY = 'mrcBackGuard'

function pushGuard(): void {
  window.history.pushState({ [BACK_GUARD_KEY]: true }, '')
}

function onPopState(): void {
  // This gesture consumed the guard entry. Put it back before handing the
  // gesture on, so the next back press is also handled inside the app.
  pushGuard()
  // Newest handler first: a sheet on top of a page closes before the page
  // itself steps back. With no handler the app is at its first page and the
  // gesture is intentionally ignored.
  handlers[handlers.length - 1]?.()
}

/**
 * Arms the guard entry and listens for the back gesture. Safe to call more than
 * once: the listener and the extra history entry are created only once.
 */
export function installBackGuard(): void {
  if (installed) return
  installed = true
  if ((window.history.state as Record<string, unknown> | null)?.[BACK_GUARD_KEY] !== true) {
    pushGuard()
  }
  window.addEventListener('popstate', onPopState)
}

/**
 * One back step, for the Android hardware/gesture back button: Capacitor
 * delivers `backButton` events instead of history pops, so the app shell
 * forwards them here. Returns false when nothing handled the step (the app
 * is on its first page — the caller must NOT exit; the gesture is swallowed
 * there too, so back never closes the app unexpectedly).
 */
export function triggerNativeBack(): boolean {
  const handler = handlers[handlers.length - 1]
  if (!handler) return false
  handler()
  return true
}

/**
 * Registers the screen that owns the back gesture while it is open, and returns
 * the cleanup that releases it. Handlers run newest-first.
 */
export function pushBackHandler(handler: BackHandler): () => void {
  installBackGuard()
  handlers.push(handler)
  let registered = true
  return () => {
    if (!registered) return
    registered = false
    const index = handlers.lastIndexOf(handler)
    if (index >= 0) handlers.splice(index, 1)
  }
}
