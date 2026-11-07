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

// 4. THE ACTUAL CAUSE. postSplashScreenTheme is applied by
//    SplashScreen.installSplashScreen(), and MainActivity never called it — so
//    the activity ran on Theme.SplashScreen for its whole life, that theme
//    allows a title bar, and the bar painted `android:background` (the splash
//    drawable) behind the app label. That is the strip: "MedRep Pro" on a
//    background of splash artwork, which is why it looked different after the
//    artwork was regenerated.
assert.match(
  activity,
  /SplashScreen\.installSplashScreen\(this\)/,
  'MainActivity installs the splash screen, which is what applies postSplashScreenTheme',
)
assert.match(
  styles,
  /<style name="AppTheme\.NoActionBarLaunch"[\s\S]*?<item name="android:windowNoTitle">true<\/item>/,
  'the splash theme forbids a title bar itself, in case the handover is skipped',
)
assert.doesNotMatch(
  styles,
  /<item name="android:background">@drawable\/splash<\/item>/,
  'the theme never paints splash artwork behind window chrome',
)

// 5. The stock Capacitor splash PNGs are gone: the launch screen is the
//    standard Android 12+ splash (brand icon on white) back-ported to API 24.
import { readdir } from 'node:fs/promises'

const resRoot = new URL('../android/app/src/main/res/', import.meta.url)
const leftovers = []
for (const entry of await readdir(resRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^drawable/.test(entry.name)) continue
  if ((await readdir(new URL(`${entry.name}/`, resRoot))).includes('splash.png')) {
    leftovers.push(entry.name)
  }
}
assert.deepEqual(leftovers, [], `stock splash artwork still shipped in: ${leftovers.join(', ')}`)
assert.match(
  styles,
  /<item name="windowSplashScreenAnimatedIcon">@mipmap\/ic_launcher<\/item>/,
  'the launch icon is our own launcher mark',
)

console.log('android shell: no title bar, no stock splash — passed')
