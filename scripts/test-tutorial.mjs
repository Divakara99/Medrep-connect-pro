import assert from 'node:assert/strict'
import {
  TUTORIAL_LANGUAGES,
  TUTORIAL_SLIDE_MS,
  preferredTutorialLanguage,
} from '../src/data/tutorial.ts'

/**
 * "How to use the app" tour (src/data/tutorial.ts + HowToUse.tsx).
 *
 * The product rule: the button asks for a language FIRST, then the tour plays in
 * that language, and the founder's introduction is always step one. These checks
 * keep every translation complete and speakable, so adding a language can never
 * ship a half-filled tour that reads English text with a Hindi voice.
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

  // The speech engine receives this exact tag; a wrong tag means silence.
  assert.match(lang.voice, /^[a-z]{2}-IN$/, `${lang.code}: voice tag is <lang>-IN`)
  assert.equal(lang.voice.split('-')[0], lang.code, `${lang.code}: voice tag matches the code`)

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

  // Optional recorded media must be an absolute site path so the WebView can
  // load it from the bundled /public folder.
  if (lang.videoUrl) assert.match(lang.videoUrl, /^\//, `${lang.code}: videoUrl starts with /`)
  if (lang.audioUrl) assert.match(lang.audioUrl, /^\//, `${lang.code}: audioUrl starts with /`)
}

// Slide pacing stays in a human range (8–15 s) — too fast is unreadable.
assert.ok(TUTORIAL_SLIDE_MS >= 8000 && TUTORIAL_SLIDE_MS <= 15000, 'slide pacing is reasonable')

// Device-language resolution: honour a known language, fall back to English.
assert.equal(preferredTutorialLanguage('hi-IN').code, 'hi')
assert.equal(preferredTutorialLanguage('ta').code, 'ta')
assert.equal(preferredTutorialLanguage('en-GB').code, 'en')
assert.equal(preferredTutorialLanguage('fr-FR').code, 'en', 'unknown device language → English')
assert.equal(preferredTutorialLanguage('').code, 'en', 'empty locale → English')
assert.equal(preferredTutorialLanguage(undefined).code, 'en', 'missing locale → English')

console.log('tutorial tour: 7 languages, founder intro first, speakable pacing and language fallback passed')
