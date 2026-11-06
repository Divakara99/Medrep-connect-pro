import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * The sign-in screen used to lurch upward the moment an email or password field
 * was focused: the soft keyboard opened, and instead of the app resizing around
 * it, the whole window panned. Three separate things have to stay right for that
 * to remain fixed.
 */
const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const login = await readFile(new URL('../src/screens/LoginScreen.tsx', import.meta.url), 'utf8')

// 1. The activity must resize for the keyboard. Without an explicit mode,
//    Android's adjustUnspecified lets the system pan the window instead.
assert.match(
  manifest,
  /android:windowSoftInputMode="adjustResize"/,
  'MainActivity resizes for the soft keyboard instead of panning the window',
)
assert.doesNotMatch(
  manifest,
  /windowSoftInputMode="adjustPan"/,
  'adjustPan pushes the whole page up — never use it',
)

// 2. Chrome 108+ honours interactive-widget: the layout viewport shrinks with
//    the keyboard rather than the page scrolling underneath it.
assert.match(
  html,
  /name="viewport"[^>]*interactive-widget=resizes-content/,
  'the viewport resizes its content when the keyboard opens',
)
assert.match(
  html,
  /name="viewport"[^>]*viewport-fit=cover/,
  'the viewport still allows edge-to-edge with safe-area insets',
)

// 3. A vertically centred card re-centres in the shorter viewport, which is the
//    visible jump. The login shell anchors to the top on phones and keeps the
//    centred look from the sm breakpoint up.
assert.match(login, /data-login-shell/, 'the sign-in shell is identifiable')
assert.match(
  login,
  /flex items-start sm:items-center justify-center/,
  'the sign-in card is top-aligned on phones and centred only on wider screens',
)
assert.doesNotMatch(
  login,
  /flex-1 flex items-center justify-center/,
  'the sign-in card must not be centred on a phone, where the keyboard shrinks the viewport',
)

console.log('keyboard layout: adjustResize, resizes-content viewport, top-aligned sign-in — passed')
