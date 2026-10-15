# Play Store listing kit — MedRep Pro

| Asset | File | Status |
|---|---|---|
| App icon (512×512) | `icon-512.png` | ✅ Generated from `src/assets/logo.svg` (`npm run store:assets`) |
| Feature graphic (1024×500) | `feature-graphic.png` | ✅ Generated |
| Short description (≤80 chars) | `short-description.txt` | ✅ Ready |
| Full description (≤4000 chars) | `full-description.txt` | ✅ Ready |
| Data safety answers | `data-safety.md` | ✅ Ready to copy into Play Console |
| Reviewer notes + test-login placeholders | `reviewer-notes.md` | ⚠ Fill the two `<…>` placeholders at submission (never commit real credentials) |
| Screenshots (1080×1920 ×4) | `screenshot-*.png` | ⚠ **TEMPLATES — replace with real captures** (below) |

## Real screenshots (required before submitting)

Google Play requires screenshots of the actual app. Install the debug APK
(Android workflow artifact `medrep-pro-debug-apk`), sign in, and capture:

1. **Home** — job feed with a pinned MR job and a locked company.
2. **A job with "Watch video to unlock company name"** visible (free account).
3. **Job details** — public fields + locked contact card.
4. **Plans** — plan list with Google Play prices (closed-test build so prices show).

On the phone: Power + Volume-down. Keep 1080×1920 (or your phone's full size, min 320px,
max 3840px per side). Overwrite the four template PNGs with the same filenames.

## Listing settings

- **Contains ads:** Yes · **Target audience:** 18 and over · **Category:** Business (or Job search if offered)
- **Privacy policy:** https://medrepconnect.in/privacy-policy.html
- Contact email, app name **MedRep Pro**, package **in.medrepconnect.app** — all per ANDROID.md.
