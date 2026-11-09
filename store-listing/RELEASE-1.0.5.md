# Release 1.0.5 (versionCode 7) — AAB + Play notes

## 1. The AAB

The signed bundle was produced by GitHub Actions, not on this machine — the sandbox
cannot reach the artifact storage, so download it from the run page:

**Run:** https://github.com/Divakara99/Medrep-connect-pro/actions/runs/42585663348

| Artifact | Size | What it is |
| --- | --- | --- |
| `medrep-pro-release-aab` | 22.8 MB | **Upload this to Play Console.** Signed release bundle. |
| `medrep-pro-release-apk` | 20.6 MB | Signed release APK, for side-loading/testing on a phone. |
| `medrep-pro-debug-apk` | 26.1 MB | Debug APK, not for Play. |

Open the run → **Artifacts** → click `medrep-pro-release-aab` to download the zip, then
unzip it. The file inside is `app-release.aab`.

Build facts, for the record:

- Commit **`23af59c`** on `arena/ec9bec06-medrep-connect-pro`
- `versionName "1.0.5"`, `versionCode 7` (`android/app/build.gradle`)
- Both jobs green: **Signed release AAB**, **Debug APK**
- Signed with the upload keystore from the repo secrets; the workflow's own
  "Verify the AAB is signed" step passed.
- Play accepts a versionCode only once. If anything changes, the next upload is vc8.

## 2. Release notes — paste into Play Console

Play requires each language's block wrapped in that language's tag, and each block
must stay under 500 characters. **1.0.5 en-IN = 405 characters, hi-IN = 392.**

### English (India)

```
<en-IN>
• Share any vacancy to WhatsApp in one tap — the message carries the role, city and the Play Store link, never the company name or contact details.
• Unlock one vacancy's manager contact for ₹5. One payment, no countdown, nothing renews.
• Jobs can be filtered by city and HQ, and your profile now saves to your account.
• Passes are plain price boxes; the details open on their own page.
</en-IN>
```

### Hindi

```
<hi-IN>
• किसी भी नौकरी को एक टैप में WhatsApp पर शेयर करें — संदेश में पद, शहर और Play Store लिंक जाता है, कंपनी का नाम या संपर्क नहीं।
• ₹5 में एक नौकरी का मैनेजर संपर्क खोलें। एक ही भुगतान, कोई समय-सीमा नहीं, कोई नवीनीकरण नहीं।
• नौकरियाँ शहर और HQ से छाँटें, और आपकी प्रोफ़ाइल अब आपके अकाउंट में सेव होती है।
• पास अब सादे प्राइस बॉक्स हैं; पूरी जानकारी अपने अलग पेज पर खुलती है।
</hi-IN>
```

If the listing's second language is English (United States) instead of Hindi, use
`<en-US>` with the English text.

## 3. Upload steps

1. Play Console → your app → **Testing → Closed testing** (or **Production**) → **Create new release**.
2. **Release name**: `1.0.5 (vc7)`.
3. Upload `app-release.aab`; confirm Play shows **versionCode 7**.
4. Paste the notes above, one block per language.
5. Rollout: staged 20% → 50% → 100%. 1.0.3 (vc5) stays available for rollback.
6. On a device that had the old build uninstalled first, install from Play, then
   Menu → Account and check the stamp reads **1.0.5 (7)** before judging anything.

## 4. One thing to settle before you upload

The ₹5 in-app job unlock is enabled in this build
(`ANDROID_IN_APP_JOB_UNLOCK = true` in `src/data/jobUnlock.ts`). Play's India
minimum for **Play Billing** in-app products is ₹10, which is why that ₹5 is charged
through Razorpay Checkout inside the app. Shipping a purchase that bypasses Play
Billing requires **User Choice Billing (India)** enrolment.

- **If you are enrolled**, upload as-is.
- **If you are not enrolled yet**, the safe build hides that button. Flipping
  `ANDROID_IN_APP_JOB_UNLOCK` to `false` and rebuilding (vc8) removes the ₹5 button
  in the app; the website keeps it either way.

Everything else in 1.0.5 is unaffected by that switch.

## 5. Not in Play Console

- AdMob App ID, banner and rewarded unit IDs are in the build.
- `app-ads.txt` is served from https://medrepconnect.in/app-ads.txt
- Supabase keys, Edge Functions and prices are server-side.
- The website keeps Razorpay/UPI and shows no ads.
