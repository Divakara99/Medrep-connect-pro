import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * Native window chrome.
 *
 * A strip reading "MedRep Pro" — the app's own label — appeared between the
 * status bar and the web header on a tablet. That text is not in the web UI
 * anywhere (the header says "MedRep Connect Pro"), so it had to come from the
 * Android window: an AppCompat title bar, drawn because the activity was left on
 * a theme that allows one.
 *
 * Three separate declarations have to stay right for that to remain impossible.
 */
const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
const styles = await readFile(new URL('../android/app/src/main/res/values/styles.xml', import.meta.url), 'utf8')
const activity = await readFile(
  new URL('../android/app/src/main/java/in/medrepconnect/app/MainActivity.java', import.meta.url),
  'utf8',
)

// 1. The application theme must be a NoActionBar one. AppTheme inherits from
//    Theme.AppCompat.Light.DarkActionBar, which is exactly how a title bar
//    reading the app label gets drawn.
assert.match(
  manifest,
  /<application[\s\S]*?android:theme="@style\/AppTheme\.NoActionBar"/,
  'the application theme has no action bar',
)
assert.doesNotMatch(
  manifest,
  /android:theme="@style\/AppTheme"/,
  'never fall back to the DarkActionBar theme',
)

// 2. The splash theme must hand over. Without postSplashScreenTheme the activity
//    stays on Theme.SplashScreen after the splash, and AppCompat decorates the
//    window with the activity label.
assert.match(
  styles,
  /<style name="AppTheme\.NoActionBarLaunch"[\s\S]*?<item name="postSplashScreenTheme">@style\/AppTheme\.NoActionBar<\/item>/,
  'the splash theme hands over to the NoActionBar theme',
)
assert.match(
  styles,
  /<style name="AppTheme\.NoActionBar"[\s\S]*?<item name="windowActionBar">false<\/item>/,
  'the NoActionBar theme really disables the action bar',
)

// 3. And the activity hides one anyway if a future theme hands it out.
assert.match(activity, /getSupportActionBar\(\) != null/, 'MainActivity hides an action bar if one exists')

// 4. The launch splash is drawn from our own mark. It shipped as the stock
//    Capacitor artwork (white with two blue slashes) for the life of the app,
//    and that image is what showed above the WebView while it started.
import { readdir, stat } from 'node:fs/promises'

const resRoot = new URL('../android/app/src/main/res/', import.meta.url)
const splashDirs = (await readdir(resRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^drawable/.test(entry.name))
  .map((entry) => entry.name)
let checked = 0
for (const dirName of splashDirs) {
  const files = await readdir(new URL(`${dirName}/`, resRoot))
  if (!files.includes('splash.png')) continue
  const file = new URL(`${dirName}/splash.png`, resRoot)
  const size = (await stat(file)).size
  // The stock splash is a mostly-white image with a small blue glyph and
  // compresses to a few KB; ours carries the brand tile and is larger.
  assert.ok(size > 4000, `${dirName}/splash.png looks like the stock blank splash (${size} bytes)`)
  checked += 1
}
assert.ok(checked >= 10, 'every orientation/density splash is regenerated from our logo')

const generator = await readFile(new URL('../scripts/generate-android-icons.mjs', import.meta.url), 'utf8')
assert.match(generator, /mrc-tile/, 'the splash generator paints the brand tile behind the glyph')

console.log('android shell: no action bar above the WebView, branded splash — passed')
