// If the app cannot start, say why instead of leaving a blank screen.
//
// A blank page is the worst failure mode we can ship: the user cannot tell a
// slow network from a crash, and nothing can be reported. This watcher runs
// before React mounts. If an error is thrown (or nothing has painted after a
// generous wait), it replaces the placeholder with a short explanation and a
// Reload button. Once the app is up it steps out of the way and never touches
// the page again.
//
// Nothing here depends on React or the design system, because the failure it
// describes can happen before either is available.

/**
 * A cold start on a slow phone should never be judged sooner than this. The app
 * has its own loading screen, which counts as started — this timer only matters
 * while the static placeholder from index.html is still the whole page.
 */
const GIVE_UP_AFTER_MS = 20_000

type Guard = { stop: () => void }

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 160)
  if (typeof error === 'string' && error.trim()) return error.slice(0, 160)
  return 'The app hit an unexpected problem while starting.'
}

/**
 * The first stack frame that belongs to the app, so a screenshot of this panel
 * is enough to locate a startup failure without a desktop devtools session.
 */
function where(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return ''
  const frame = error.stack
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^at\s/.test(line) && /\.(tsx?|jsx?)/.test(line))
  return frame ? frame.replace(/^at\s+/, '').slice(0, 140) : ''
}

function paint(reason: string, source = ''): void {
  const root = document.getElementById('root')
  if (!root || root.dataset.bootState === 'failed') return
  root.dataset.bootState = 'failed'
  root.textContent = ''

  const panel = document.createElement('div')
  panel.setAttribute('role', 'alert')
  panel.style.cssText = [
    'min-height:100vh',
    'display:grid',
    'place-items:center',
    'padding:24px',
    'background:#eef5ff',
    'color:#131f57',
    'font:500 16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif',
    'text-align:center',
  ].join(';')

  const card = document.createElement('div')
  card.style.cssText = 'max-width:420px;display:grid;gap:12px'

  const title = document.createElement('div')
  title.textContent = 'MedRep Pro could not open'
  title.style.cssText = 'font-size:20px;font-weight:800'

  const detail = document.createElement('div')
  detail.textContent = reason
  detail.style.cssText = 'color:#334155'

  const sourceLine = document.createElement('div')
  sourceLine.textContent = source
  sourceLine.style.cssText = 'font:600 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#64748b;word-break:break-word'

  const hint = document.createElement('div')
  hint.textContent = 'Check your internet connection, then reload. If it keeps happening, message support from the app.'
  hint.style.cssText = 'font-size:14px;color:#475569'

  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Reload'
  button.style.cssText = [
    'justify-self:center',
    'margin-top:4px',
    'border:0',
    'border-radius:14px',
    'padding:12px 22px',
    'font:700 15px system-ui,sans-serif',
    'color:#fff',
    'background:#1b4efb',
    'cursor:pointer',
  ].join(';')
  button.addEventListener('click', () => window.location.reload())

  const parts = sourceLine.textContent?.trim() ? [title, detail, sourceLine, hint, button] : [title, detail, hint, button]
  card.append(...parts)
  panel.append(card)
  root.append(panel)
}

/**
 * Start watching. Returns a handle so tests (and a future hot path) can stop it.
 */
export function installBootGuard(): Guard {
  let done = false
  const startedAt = Date.now()
  // The static "Loading your account…" node from index.html. React removes it
  // when it paints; that removal is the signal that the app started. Counting
  // text instead would also match the app's own loading screen and fire a
  // false alarm on a slow connection.
  const placeholder = document.getElementById('root')?.firstElementChild ?? null

  const stop = () => {
    done = true
    window.clearInterval(timer)
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }

  const fail = (reason: unknown) => {
    if (done) return
    stop()
    paint(describe(reason), where(reason))
  }

  const onError = (event: ErrorEvent) => fail(event.error ?? event.message)
  const onRejection = (event: PromiseRejectionEvent) => fail(event.reason)

  const timer = window.setInterval(() => {
    const root = document.getElementById('root')
    if (!root) return
    // React painted something and replaced the placeholder: the app is up.
    if (root.childElementCount > 0 && (!placeholder || !root.contains(placeholder))) {
      stop()
      return
    }
    if (Date.now() - startedAt > GIVE_UP_AFTER_MS && root.childElementCount === 0) {
      fail('The app is taking longer than usual to load.')
    }
  }, 500)

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return { stop }
}
