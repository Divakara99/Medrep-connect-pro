import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * Pull-to-refresh.
 *
 * The Android WebView has no native pull-to-refresh, so the app has to provide
 * one. It matters beyond convenience: the job list is the only place the
 * per-job `companyUnlocked` flag appears, so without a refresh a company
 * unlocked with a rewarded video could stay locked until the next login.
 */
const hook = await readFile(new URL('../src/components/usePullToRefresh.ts', import.meta.url), 'utf8')
const indicator = await readFile(new URL('../src/components/PullToRefresh.tsx', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

// 1. The gesture must not fight ordinary scrolling: it only engages at the top.
assert.match(hook, /window\.scrollY \|\| document\.documentElement\.scrollTop/, 'only engages at the top of the page')
assert.match(hook, /touches\.length !== 1/, 'one finger only')

// 2. The move handler must be able to hold the page still, which requires a
//    non-passive listener; a passive one silently ignores preventDefault.
assert.match(hook, /'touchmove', onMove, \{ passive: false \}/, 'touchmove is non-passive so the drag is not a scroll')
assert.match(hook, /event\.preventDefault\(\)/, 'the page is held while the indicator is dragged out')

// 3. Release below the threshold cancels, above it refreshes.
assert.match(hook, /if \(travelled < THRESHOLD\)/, 'a short pull cancels')
assert.match(hook, /void run\(\)/, 'a real pull refreshes')

// 4. The indicator says what it is doing, and disappears when idle.
assert.match(indicator, /data-pull-to-refresh=\{[^}]*'refreshing'[^}]*'release'[^}]*'pull'/s, 'the indicator reports its state')
assert.match(indicator, /Pull to refresh/, 'pull hint')
assert.match(indicator, /Release to refresh/, 'release hint')
assert.match(indicator, /Refreshing…/, 'in-progress hint')

// 5. Wiring: the app refreshes the SERVER projection, not local state.
assert.match(app, /usePullToRefresh\(refreshFromServer/, 'App wires the gesture to the refresh')
assert.match(app, /const refreshFromServer = useCallback/, 'refreshFromServer exists')
assert.match(
  app,
  /refreshFromServer = useCallback\([\s\S]*?await loadVisibleJobs\(\)[\s\S]*?setJobs\(fresh\)/,
  'refreshing re-reads list_visible_jobs and replaces the list',
)
assert.match(app, /<PullToRefreshIndicator pull=\{pull\} refreshing=\{refreshing\} \/>/, 'the indicator is rendered')

console.log('pull to refresh: top-only gesture, server re-read, honest indicator — passed')
