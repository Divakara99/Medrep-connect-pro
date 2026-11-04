import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import {
  TUTORIAL_DEFAULT_VIDEO,
  TUTORIAL_LANGUAGES,
  TUTORIAL_VIDEO_CONFIG_URL,
  isDirectVideoFile,
  preferredTutorialLanguage,
  resolveTutorialVideo,
  sanitizeVideos,
  toEmbeddableUrl,
} from '../src/data/tutorial.ts'

/**
 * "How to use the app" tour (src/data/tutorial.ts + HowToUse.tsx).
 *
 * Product rules:
 *   - the button asks for a language FIRST, then the tour plays in it;
 *   - the founder's introduction is always step one;
 *   - narration is a REAL recorded video per language — never a synthetic voice.
 *     A language without a recording shows the written steps instead, so every
 *     translation must be complete and readable on its own.
 */

const EXPECTED = ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr']

assert.equal(TUTORIAL_LANGUAGES.length, EXPECTED.length, 'one entry per supported language')
assert.deepEqual(
  TUTORIAL_LANGUAGES.map((l) => l.code),
  EXPECTED,
  'language codes are unique and in the declared order',
)
assert.equal(TUTORIAL_LANGUAGES[0].code, 'en', 'English is first so it is the safe fallback')

const seenLabels = new Set()
for (const lang of TUTORIAL_LANGUAGES) {
  assert.match(lang.label, /\S/, `${lang.code}: native label is set`)
  assert.match(lang.english, /\S/, `${lang.code}: English label is set`)
  assert.ok(!seenLabels.has(lang.label.toLowerCase()), `${lang.code}: label is not duplicated`)
  seenLabels.add(lang.label.toLowerCase())

  // Used as the video's lang attribute (captions/translation prompts).
  assert.match(lang.locale, /^[a-z]{2}-IN$/, `${lang.code}: locale is <lang>-IN`)
  assert.equal(lang.locale.split('-')[0], lang.code, `${lang.code}: locale matches the code`)

  // Step 1 is the founder's introduction, then the five how-to steps.
  assert.equal(lang.slides.length, 6, `${lang.code}: founder intro + 5 steps`)
  assert.match(lang.slides[0].title, /\S/, `${lang.code}: intro has a title`)
  assert.match(lang.slides[0].body, /\S/, `${lang.code}: intro has a spoken body`)

  const bodies = new Set()
  for (const [i, slide] of lang.slides.entries()) {
    assert.match(slide.title.trim(), /\S/, `${lang.code} slide ${i}: title is not empty`)
    const body = slide.body.trim()
    assert.ok(body.length >= 40, `${lang.code} slide ${i}: body is long enough to narrate`)
    // ~11 s per slide at speaking rate; anything far longer overruns the slide.
    assert.ok(body.length <= 320, `${lang.code} slide ${i}: body fits one slide (${body.length})`)
    assert.ok(!bodies.has(body), `${lang.code} slide ${i}: body is not a duplicate`)
    bodies.add(body)
  }

  // A baked-in link is optional (links normally come from videos.json), but if
  // present it must be a real http(s) URL or a bundled path.
  if (lang.videoUrl) {
    assert.match(lang.videoUrl, /^(https?:\/\/|\/)/, `${lang.code}: videoUrl is http(s) or bundled`)
  }
}

// Where finished recordings are published; must stay on the app's own domain so
// the APK never depends on a third-party host for its configuration.
assert.match(TUTORIAL_VIDEO_CONFIG_URL, /^https:\/\/[^/]+\/tutorial\/videos\.json$/)

// Direct files play in a <video>; everything else is embedded in an iframe.
assert.equal(isDirectVideoFile('https://medrepconnect.in/tutorial/en.mp4'), true)
assert.equal(isDirectVideoFile('https://medrepconnect.in/tutorial/te.mp4?t=3'), true)
assert.equal(isDirectVideoFile('https://medrepconnect.in/tutorial/kn.WEBM'), true)
assert.equal(isDirectVideoFile('https://go.screenpal.com/player/cOXflBnyS1e'), false)
assert.equal(isDirectVideoFile('https://youtu.be/abc123'), false)

// Device-language resolution: honour a known language, fall back to English.
assert.equal(preferredTutorialLanguage('hi-IN').code, 'hi')
assert.equal(preferredTutorialLanguage('ta').code, 'ta')
assert.equal(preferredTutorialLanguage('en-GB').code, 'en')
assert.equal(preferredTutorialLanguage('fr-FR').code, 'en', 'unknown device language → English')
assert.equal(preferredTutorialLanguage('').code, 'en', 'empty locale → English')
assert.equal(preferredTutorialLanguage(undefined).code, 'en', 'missing locale → English')

// videos.json is fetched at runtime, so it is treated as untrusted input.
assert.deepEqual(sanitizeVideos(null), {}, 'null config → no videos')
assert.deepEqual(sanitizeVideos('https://evil.example/x.mp4'), {}, 'string config → ignored')
assert.deepEqual(
  sanitizeVideos({ en: ' https://go.screenpal.com/watch/cOXflBnyS1e ', hi: 'javascript:alert(1)', xx: 'https://x.example/a.mp4' }),
  { en: 'https://go.screenpal.com/watch/cOXflBnyS1e' },
  'only http(s) links for shipped languages survive (javascript: and unknown codes dropped)',
)

// Shared links are normalised to something embeddable.
assert.equal(
  toEmbeddableUrl('https://go.screenpal.com/watch/cOXflBnyS1e'),
  'https://go.screenpal.com/player/cOXflBnyS1e',
  'ScreenPal watch link → player link',
)
assert.equal(toEmbeddableUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1')
assert.equal(
  toEmbeddableUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
  'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1',
)
assert.equal(
  toEmbeddableUrl('https://medrepconnect.in/tutorial/en.mp4'),
  'https://medrepconnect.in/tutorial/en.mp4',
  'direct files are left alone',
)

// The bundled walkthrough must ship with the app: it is what plays before any
// per-language recording exists (silent, built from this project's screens).
assert.equal(TUTORIAL_DEFAULT_VIDEO, '/tutorial/walkthrough.mp4')
const walkthrough = new URL('../public/tutorial/walkthrough.mp4', import.meta.url)
assert.ok(existsSync(walkthrough), 'public/tutorial/walkthrough.mp4 is committed')
const walkthroughMb = statSync(walkthrough).size / (1024 * 1024)
assert.ok(walkthroughMb > 0.05 && walkthroughMb < 12, `walkthrough size is sane (${walkthroughMb.toFixed(1)} MB)`)

// Languages with their own narrated cut play it; the rest fall back to the
// silent walkthrough (with the written steps in that language).
const narrated = ['en', 'hi', 'te']
for (const code of narrated) {
  const lang = TUTORIAL_LANGUAGES.find((l) => l.code === code)
  const own = resolveTutorialVideo(lang, {})
  assert.equal(own.url, `/tutorial/${code}.mp4`, `${code}: plays its own narrated video`)
  assert.equal(own.shared, false, `${code}: not treated as the shared fallback`)

  const file = new URL(`../public/tutorial/${code}.mp4`, import.meta.url)
  assert.ok(existsSync(file), `public/tutorial/${code}.mp4 is committed`)
  const mb = statSync(file).size / (1024 * 1024)
  assert.ok(mb > 0.3 && mb < 20, `${code}: video size is sane (${mb.toFixed(1)} MB)`)
}

const pending = TUTORIAL_LANGUAGES.find((l) => l.code === 'mr')
assert.equal(resolveTutorialVideo(pending, {}).shared, true, 'no recording → shared walkthrough')
assert.equal(resolveTutorialVideo(pending, {}).url, TUTORIAL_DEFAULT_VIDEO)
const recorded = resolveTutorialVideo(pending, { mr: 'https://youtu.be/abc12345678' })
assert.equal(recorded.shared, false, 'a published recording wins')

// Every language resolves to something playable.
for (const lang of TUTORIAL_LANGUAGES) {
  const resolved = resolveTutorialVideo(lang, {})
  assert.match(resolved.url, /^(\/|https?:\/\/)/, `${lang.code}: resolves to a playable URL`)
}

console.log('tutorial tour: 7 languages, founder intro first, en/hi/te narrated videos + silent fallback and link safety passed')
