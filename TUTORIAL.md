# "How to use the app" — recorded video tour, one per language

The sign-in page has one button: **How to use the app**. It never autoplays. It
opens a language picker, and only after the user picks a language does the tour
play — starting with the founder's introduction.

**Narration is a real recorded video, never a synthetic voice.** A language whose
recording is not ready yet shows the written steps instead of computer speech.

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
  "en": "https://go.screenpal.com/watch/cOXflBnyS1e",
  "hi": "https://youtu.be/XXXXXXXXXXX",
  "te": "https://medrepconnect.in/tutorial/te.mp4"
}
```

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
