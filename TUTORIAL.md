# "How to use the app" — recorded video tour, one per language

The sign-in page has one button: **How to use the app**. It never autoplays. It
opens a language picker, and only after the user picks a language does the tour
play — starting with the founder's introduction.

**No synthetic voice anywhere.** Every language plays a video:

- the **built-in walkthrough** (`public/tutorial/walkthrough.mp4`, 44 s, silent,
  generated from this project's own screens) until a spoken recording exists —
  the written steps are shown underneath it in the chosen language;
- the **real recorded video** for a language once its link is published.

The built-in walkthrough is silent on purpose: narration must be a human voice.

## The built-in walkthrough (already in the app)

`public/tutorial/walkthrough.mp4` is generated from the repo's own artwork — 44 s,
1080×1920, 24 fps, ~0.95 MB, bundled into the APK so it works offline:

| Scene | Source |
|---|---|
| Intro card | `store-listing/icon-512.png` + founder credit |
| Step 1 — find live MR & pharma jobs | `store-listing/screenshot-1-home.png` |
| Step 2 — unlock company names free | `screenshot-2-unlock.png` |
| Step 3 — see every job detail | `screenshot-3-details.png` |
| Step 4 — choose a pass | `screenshot-4-plans.png` |
| Outro — apply in one tap, medrepconnect.in | brand gradient |

Regenerate it after any artwork change:

```bash
python3 -m venv .videnv && .videnv/bin/pip install imageio-ffmpeg pillow
.videnv/bin/python scripts/build-tutorial-video.py
```

Add a spoken version without re-rendering the picture — record your voice for the
same beats, then mux:

```bash
ffmpeg -i public/tutorial/walkthrough.mp4 -i public/tutorial/en.mp3 \
       -c:v copy -c:a aac -b:a 128k -shortest public/tutorial/en.mp4
```

Then publish `en.mp4` in `videos.json` (below) and the app plays that instead.

## How a language becomes "live"

1. **Record** the walkthrough in that language (spec below) — a screen recording
   with your own voice, like the ScreenPal reference
   `https://go.screenpal.com/watch/cOXflBnyS1e` (1:39, screen + voice).
2. **Upload** it anywhere embeddable: ScreenPal, unlisted YouTube, or as an MP4
   on the website at `https://medrepconnect.in/tutorial/<code>.mp4`.
3. **Publish the link** in `public/tutorial/videos.json` (live at
   `https://medrepconnect.in/tutorial/videos.json`):

```json
{
  "hi": "https://medrepconnect.in/tutorial/hi.mp4",
  "te": "https://youtu.be/XXXXXXXXXXX"
}
```

(Leave a language out and it plays the bundled silent walkthrough plus the
written {language} steps.)

Language codes: `en` English · `hi` Hindi · `te` Telugu · `ta` Tamil ·
`kn` Kannada · `ml` Malayalam · `mr` Marathi.

4. Commit that one file. Netlify redeploys in ~2 minutes, and **every installed
   app picks it up with no Play release** — the app reads this file each time the
   tour opens. Languages without a link keep showing the written steps.

The picker shows a **Video** badge for languages that have a link, **Soon** for
the rest. Links are validated: only `http(s)` URLs for the seven codes above are
accepted; `javascript:` and unknown keys are dropped.

An MP4/WebM/MOV link plays in the phone's own video player. ScreenPal, YouTube
and Vimeo links are embedded in their player (share links like `youtu.be/ID` and
`go.screenpal.com/watch/ID` are converted automatically).

## Recording spec

| Item | Value |
|---|---|
| Length | 60–120 s (the reference is 1:39) |
| Orientation | **Portrait 1080×1920** if recorded on a phone; 1920×1080 is fine for a desktop screen recording |
| Format | MP4 (H.264) or WebM; ScreenPal/YouTube links avoid file handling entirely |
| Voice | **Your own voice**, in that language — no text-to-speech, no AI dubbing |
| Audio | Phone-mic quality is enough; speak slowly, no background music |
| Size | Under 100 MB if uploading an MP4 to the website |
| Subtitles | Not required — the same words appear under the player as "Steps in this video" |

If you upload MP4s to `public/tutorial/`, keep in mind they deploy with the
website **and** would otherwise be bundled into the APK. Cap sync copies `dist/`,
so before shipping an app build strip them (the app streams from the website
instead):

```bash
rm -f android/app/src/main/assets/public/tutorial/*.mp4
```

## Shot list / script

Each language has six scripted beats in `src/data/tutorial.ts`. Read them in
order — they are also what the viewer sees under the player.

1. **Founder introduction** — "Namaste, I am M Divakar Reddy, founder of MedRep
   Pro…" (keep this framing identical in every language)
2. **Create your free account** — name, email, password of 6+ characters
3. **Find the vacancy** — Home, pinned urgent jobs first, search and filters
4. **Unlock the company name free** — "Watch video to unlock company name", one
   video, permanent, no daily limit
5. **Plans and one-time passes** — manager name/email/phone for subscribers;
   ₹19 for 1 day → ₹1799 for 1 year through Google Play; nothing auto-renews
6. **Apply in one tap** — profile + resume once, then Apply by email or WhatsApp,
   always review before sending

## Code

| File | What it holds |
|---|---|
| `src/data/tutorial.ts` | Languages, script text, video link resolution and link safety |
| `src/components/HowToUse.tsx` | Button, language picker, video/iframe player, written fallback |
| `public/tutorial/videos.json` | The live link map (edit this to publish a recording) |
| `scripts/test-tutorial.mjs` | Guards script completeness, link safety and language fallback |

## Rules that must not regress

- No synthetic voice anywhere in the tour — a missing video means written steps.
- The button plays nothing before a language is chosen.
- The founder's introduction is always the first thing in the video and the first
  written step.
- The tour appears on the **sign-in page only** — never on payment, admin or
  vacancy-team screens.
- A recording must be added to `videos.json`, not hard-coded, so fixing or
  re-shooting a video never needs a Play release.
