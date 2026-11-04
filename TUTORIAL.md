# "How to use the app" tour — languages, voice and (future) video

The sign-in page has one button: **How to use the app**. It never autoplays. It
opens a language picker, and only after the user picks a language does the tour
play — starting with the founder's introduction, then the five usage steps.

Code:

| File | What it holds |
|---|---|
| `src/data/tutorial.ts` | Languages, spoken text per slide, voice tags, optional media paths |
| `src/components/HowToUse.tsx` | The button, language picker, player and narration |
| `scripts/test-tutorial.mjs` | Guards completeness, pacing and language fallback |

## Languages shipped today (7)

English, हिन्दी (Hindi), తెలుగు (Telugu), தமிழ் (Tamil), ಕನ್ನಡ (Kannada),
മലയാളം (Malayalam), मराठी (Marathi).

Each language has 6 slides: founder introduction + create account, find a
vacancy, unlock the company name free, subscribe for manager contacts, apply in
one tap.

### Adding a language

1. Add one object to `TUTORIAL_LANGUAGES` in `src/data/tutorial.ts` with `code`,
   `label` (native), `english`, `voice` (`<code>-IN`) and 6 slides.
2. Add the code to `EXPECTED` in `scripts/test-tutorial.mjs`.
3. `npm test` — the test fails if a slide is empty, duplicated, too long for
   one slide, or if the voice tag does not match the language.

The picker, narration and fallback all read from that list; nothing else changes.

## How the voice works

Narration uses the phone's own speech engine (`speechSynthesis`), so:

- 0 bytes added to the APK, no network, works offline;
- quality depends on the device's Google TTS voices;
- if a device has no voice for the chosen language, the tour stays silent and
  shows the written steps (with a short note saying so).

That is the launch behaviour. Two upgrades exist without touching the player:

### Upgrade 1 — recorded voice-over per language

Record the slide text, save as MP3, drop it in `public/tutorial/<code>.mp3`,
then set `audioUrl: '/tutorial/<code>.mp3'` on that language. The player prefers
the recording and keeps the slides as captions.

### Upgrade 2 — real video per language

Export a 16:9 or 9:16 MP4 (≤ 20 MB is plenty), save it in
`public/tutorial/<code>.mp4`, set `videoUrl: '/tutorial/<code>.mp4'`. The player
then shows a normal `<video>` player with controls, and the slides are skipped
for that language. Files in `public/` are bundled into the APK, so the video
plays offline too.

Recommended video structure (matches the slides):

1. **0:00–0:12** Founder introduction — "Namaste, I am M Divakar Reddy, founder
   of MedRep Pro…"
2. **0:12–0:25** Create your free account (name, email, password 6+)
3. **0:25–0:40** Find the vacancy (pinned first, search and filters)
4. **0:40–0:55** Unlock the company name free by watching a video
5. **0:55–1:15** Plans and a one-time pass (₹19 for a day → ₹1799 for a year)
6. **1:15–1:30** Apply in one tap, and review before sending

Keep the founder segment identical across languages (same framing, same order)
so the tour feels like one app in every language.

## Rules that must not regress

- The button **must not** play anything before a language is chosen.
- The founder's introduction is **always** the first slide.
- The tour appears on the **sign-in page only** — never on payment, admin or
  vacancy-team screens.
- Closing the sheet always stops the narration.
