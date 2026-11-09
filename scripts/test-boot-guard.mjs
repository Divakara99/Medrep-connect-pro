// A blank screen is never an acceptable answer.
//
// If the app fails before React paints — a bad deploy, a missing chunk, a
// startup throw — the page must say what happened and offer Reload. This test
// keeps that guarantee wired: installed before render, DOM-only, quiet once the
// app is up.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

const main = await read('../src/main.tsx')
const guard = await read('../src/bootGuard.ts')
const html = await read('../index.html')

// ---------- installed before the app renders ----------
const guardCall = main.indexOf('installBootGuard()')
const renderCall = main.indexOf('createRoot(')
assert.ok(guardCall > 0, 'the guard is installed')
assert.ok(guardCall < renderCall, 'the guard runs before React mounts')
assert.ok(/import \{ installBootGuard \} from '\.\/bootGuard'/.test(main), 'the guard is imported')

// ---------- it can only describe a failure, never cause one ----------
assert.ok(!/from 'react'/.test(guard), 'the guard does not depend on React')
assert.ok(!/from '\.\/components/.test(guard), 'the guard does not depend on the design system or CSS')
assert.ok(/window\.addEventListener\('error'/.test(guard), 'a startup throw is caught')
assert.ok(/window\.addEventListener\('unhandledrejection'/.test(guard), 'a rejected startup promise is caught')
assert.ok(/GIVE_UP_AFTER_MS = 20_000/.test(guard), 'a slow cold start is given 20 seconds')
assert.ok(/firstElementChild/.test(guard), 'the static placeholder node is captured, not guessed from text')

// ---------- what the user sees ----------
assert.ok(/MedRep Pro could not open/.test(guard), 'the panel says the app could not open')
assert.ok(/button\.textContent = 'Reload'/.test(guard), 'there is a Reload button')
assert.ok(/window\.location\.reload\(\)/.test(guard), 'Reload actually reloads')
assert.ok(/role', 'alert'/.test(guard), 'the panel is announced to screen readers')
assert.ok(/Check your internet connection, then reload/.test(guard), 'the next step is spelled out')
assert.ok(/describe\(/.test(guard), 'the real error message is shown, not just "error"')

// ---------- it steps out of the way ----------
assert.ok(/root\.contains\(placeholder\)/.test(guard), 'painting is detected by the placeholder being replaced')
assert.ok(/if \(root\.childElementCount > 0 && \(!placeholder/.test(guard), 'the watcher stops once the app has painted')
assert.ok(/childElementCount === 0\) \./.test(guard) || /&& root\.childElementCount === 0/.test(guard), 'only an empty root is treated as a stall')
assert.ok(/root\.dataset\.bootState === 'failed'/.test(guard), 'the panel is never painted twice')
assert.ok(/if \(done\) return/.test(guard), 'later errors cannot replace a working app')

// ---------- the placeholder still exists, so the wait is readable ----------
assert.ok(/id="root"/.test(html), 'the mount point exists')
assert.ok(/Loading your account/.test(html), 'the first paint is a message, not emptiness')

console.log('boot guard: blank screen replaced by a reason and a Reload button — passed')
