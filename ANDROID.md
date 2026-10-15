# MedRep Pro — Android (Google Play) runbook

Everything for the Android app. The **website stays exactly as it is today**
(medrepjob.netlify.app, Razorpay/UPI, no ads) — nothing here changes it.
In-app behaviour is gated on `isAndroidApp()` (`src/data/platform.ts`), so
the web bundle never loads ads or Play Billing and keeps its service worker
and web-push UI.

| Item | Value |
|---|---|
| App name | **MedRep Pro** |
| Package ID | `in.medrepconnect.app` |
| Framework | Capacitor 8 (compiles to / targets **API 36**), bundled web build (`webDir: dist`, no remote server URL) |
| Ads | `@capacitor-community/admob` 8.x, Android only. **All IDs real**: App ID `ca-app-pub-3694622521401615~5426441207`, Banner `…/2527533866`, Rewarded `…/4112078274` (Interstitial `…/1045177214` exists in the console but is intentionally unused) |
| SDK levels (build file) | `android/variables.gradle`: **minSdk 24**, **compileSdk 36**, targetSdk 36 (requirements: min ≥ 24, compile ≥ 35 ✅) |
| Billing | `@capgo/native-purchases` 8.x → **Play Billing Library 9.1**, one-time products |
| Min SDK | 24 |

---

## 1. What's already in the repo

- `capacitor.config.ts` · `android/` project (icons generated from
  `src/assets/logo.svg` via `npm run icons:android`) · `AdBanner` +
  rewarded-unlock wiring · Google Play checkout branch in Plans (Razorpay/UPI
  is *hidden in the app only*) · no service worker / no web-push UI in the app
  · password-reset emails from the app redirect to the website ·
  Android back button steps back in-app instead of closing.
- `.github/workflows/android.yml` — debug APK + signed release AAB (§6).
- `store-listing/` — icon, feature graphic, descriptions, Data safety
  answers, reviewer notes, screenshot **templates** (replace with real
  captures, §7).
- `public/privacy-policy.html` — covers AdMob/advertising ID + Play purchases.
  Live at `https://medrepjob.netlify.app/privacy-policy.html` after the next
  Netlify deploy.
- `public/app-ads.txt` — already carries the real publisher ID
  (`pub-3694622521401615`, from the App ID); live after the next Netlify deploy.

### Password rule (also fixed in this branch)

Every account — job seeker, admin, vacancy team, on **every** page including
a staff reset that lands on the job-seeker page — needs **6+ characters, no
maximum**. The reset page resolves the rule from the resetting account's real
role. ⚠ In **Supabase → Authentication → Settings**, set **Minimum password
length = 6**, or Auth will reject passwords this app accepts.

---

## 2. Supabase: run these (in this order)

The agent environment has **no Supabase access**, so these are the exact
steps. Full commands are also in the PR description.

### 2a. SQL — Supabase → SQL Editor → New query

Run each file once, top to bottom (all are safe to re-run):

1. `supabase/company_unlocks.sql` — creates `company_unlocks` (users read own
   rows; only the service role writes; `transaction_id` UNIQUE) and replaces
   `list_visible_jobs()` so it returns `company` + `companyUnlocked` for
   unlocked jobs and the other four fields only for active subscribers.
   (The same function update is also folded into
   `supabase/vacancy_duplicate_check.sql` — always run `company_unlocks.sql`
   **after** it on existing projects.)
2. `supabase/google_play_billing.sql` — adds `billing_plans.play_product_id`
   (seeded `medrep_pass_5d … medrep_pass_365d`), extends
   `subscription_payments` for `google_play` (token-hash UNIQUE) and adds
   `confirm_google_play_subscription_payment()` /
   `mark_google_play_purchase_finalised()` /
   `handle_google_play_voided_purchase()`.

### 2b. Edge Functions — deploy

```bash
supabase functions deploy admob-reward-verification   # JWT check OFF (set in supabase/config.toml)
supabase functions deploy verify-google-play-purchase # JWT check ON
supabase functions deploy admin-manage-employees      # redeploy: team-password minimum is now 6
```

> `supabase/config.toml` already declares
> `[functions.admob-reward-verification] verify_jwt = false`. If you deploy
> via the Dashboard instead of the CLI, switch **Verify JWT OFF** for that
> one function manually — Google's callback carries no Supabase JWT.

### 2c. Edge Function secrets — Supabase → Project Settings → Edge Functions → Secrets

| Secret | Value |
|---|---|
| `ADMOB_REWARDED_AD_UNIT_ID` | Real rewarded unit: `ca-app-pub-3694622521401615/4112078274`. Must exactly match `ADMOB_REWARDED_AD_UNIT_ID` in `src/data/adConfig.ts` — the SSV function rejects callbacks for any other unit. |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | The **entire JSON** of the Google Cloud service-account key (§4). Paste as-is. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Already present for the existing functions. |

### 2d. AdMob SSV callback URL

In **AdMob → Apps → MedRep Pro → the rewarded ad unit → Server-side
verification**, set the callback URL to:

```
https://<your-project-ref>.supabase.co/functions/v1/admob-reward-verification
```

(Real units are live, so this callback is what turns a watched video into
an unlock — it must be set before testers use the unlock. The function verifies Google's ECDSA signature against
`https://www.gstatic.com/admob/reward/verifier-keys.json`, checks the ad
unit, `user_id` = Supabase user id, `custom_data` = job id, de-duplicates
`transaction_id`, and only then inserts the unlock. The app polls
`list_visible_jobs()` for ~30 s after a video completes.)

### 2e. Auth redirect allow-list

**Supabase → Authentication → URL Configuration**: make sure
`https://medrepjob.netlify.app/` is an allowed redirect URL — app-originated
password-reset emails land there.

---

## 3. AdMob setup

1. ✅ **Done:** the app exists in AdMob and its real **App ID**
   `ca-app-pub-3694622521401615~5426441207` is set in
   `android/app/src/main/AndroidManifest.xml`
   (`com.google.android.gms.ads.APPLICATION_ID`) and mirrored as
   `ADMOB_APP_ID` in `src/data/adConfig.ts`. `public/app-ads.txt` already
   serves the matching real publisher ID (`pub-3694622521401615`) — check
   `https://medrepjob.netlify.app/app-ads.txt` after the next site deploy.
2. ✅ **Done:** units created in the console and wired into
   `src/data/adConfig.ts` — **Banner home screen**
   `ca-app-pub-3694622521401615/2527533866`, **Rewarded_unlockfeature**
   `ca-app-pub-3694622521401615/4112078274`. (An **Interstitial**
   `…/1045177214` also exists; the app design doesn't use interstitials, so
   it stays unused.) Audience is India; keep age targeting at adults (18+).
3. **Still to do (owner):** set the Supabase secret
   `ADMOB_REWARDED_AD_UNIT_ID` = `ca-app-pub-3694622521401615/4112078274`
   (§2c) and the SSV callback URL on the rewarded unit (§2d) — rewarded
   unlocks only fire once both are in place.
5. UMP consent: the app requests UMP consent (`requestConsentInfo` →
   `showConsentForm` when required) before initialising ads. In the AdMob
   console, create a **GDPR message** (and keep "Do not consent" available) —
   in India it usually resolves without showing; the code paths stay correct
   if it ever fires.
6. Ads policy in the app (already coded): banner on Home/Priority/AI/Account
   only (never login/sign-up/password/Plans-payment); free users additionally
   get "Watch video to unlock company name" per locked job (no daily limit);
   subscribers see the banner only.

---

## 4. Google Play Billing setup

1. **Play Console → Users and permissions**: invite a Google Cloud service
   account and grant it **Admin (or at least: View app information, Manage
   orders and subscriptions)** for this app.
   In Google Cloud (project linked to Play Console): enable the **Google Play
   Developer API**, create the service account, and under **Keys** create a
   JSON key. That JSON (whole file) becomes the
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` Supabase secret (§2c). Treat it like a
   password: never commit it.
2. **Play Console → Monetise → Products → One-time products**: create one
   product per plan, **Active**, price = the plan price (Google adds tax):

   | Product ID | Plan | Price (₹, set in Console) |
   |---|---|---|
   | `medrep_pass_5d` | 5 Days Trial | 49 |
   | `medrep_pass_10d` | 10 Days Basic | 99 |
   | `medrep_pass_15d` | 15 Days Pro | 149 |
   | `medrep_pass_30d` | 30 Days Standard | 249 |
   | `medrep_pass_90d` | 3 Months Premium | 599 |
   | `medrep_pass_180d` | 6 Months Elite | 999 |
   | `medrep_pass_365d` | 1 Year Ultimate | 1799 |

   Prices must match `public.billing_plans.amount_paise` — the server
   activates the plan mapped by `play_product_id` and extends
   `user_accounts.subscribed_until` exactly like a Razorpay capture
   (renewals stack on the current expiry).
3. Verification flow (already coded): Play charges → app sends the token to
   `verify-google-play-purchase` → the function checks it with the Play
   Developer API → `confirm_google_play_subscription_payment()` records the
   payment (`google_play`, token **hash** unique) and extends the expiry →
   only then the purchase is acknowledged + consumed, so the pass can be
   bought again later.
4. **Refunds / voids:** a refunded token re-presented by the app is voided
   automatically (`handle_google_play_voided_purchase` — claws days back only
   when that purchase is still the latest grant, otherwise flags
   `needs_review` for a human). For refunds the app never re-presents, poll
   the voided list on a schedule (e.g. Supabase scheduled function / cron,
   daily) with `PlayApi.listVoided()` (in
   `supabase/functions/_shared/googleplay.ts`) and call the same SQL function
   per token hash. Google Play refunds themselves are issued from Play
   Console → Orders; the app cannot refund.

---

## 5. Upload key (Play App Signing)

**An upload key has already been generated for you in this workspace:**
`keys/upload-keystore.p12` (PKCS#12, alias `upload`, password in
`keys/UPLOAD-KEY-BACKUP.txt`, valid until 2054, cert SHA-256
`81:61:07:C5:FF:AF:6F:0C:2C:08:84:C8:DD:9C:8C:37:7C:4C:3F:8A:70:B9:22:10:50:19:B1:65:C2:10:54:4B`).
The agent's GitHub token can't write Actions secrets (403), so add them
yourself — 2 minutes:

1. **Download `keys/` now** and back it up: password manager + one offline
   copy (USB/printed). Anyone holding keystore + password can sign updates
   as MedRep Pro. `keys/` is git-ignored and is **not** in the repo.
   (Lost upload key ≠ disaster — Google can reset an *upload* key — but it
   costs days, so back it up.)
2. GitHub → repo → **Settings → Secrets and variables → Actions**:
   - Secret `ANDROID_KEYSTORE_BASE64` = output of
     `base64 -w0 keys/upload-keystore.p12`
   - Secret `ANDROID_KEYSTORE_PASSWORD` = the password in the backup file
   - Secret `ANDROID_KEY_ALIAS` = `upload`
   - Secret `ANDROID_KEY_PASSWORD` = same password
   - **Variable** `ANDROID_SIGNING_CONFIGURED` = `true` (this switches the
     release-AAB job on; without it that job skips, debug APK still builds)
3. Local builds instead: create `android/keystore.properties` (git-ignored):
   ```properties
   storeFile=../../keys/upload-keystore.p12
   storePassword=<password>
   keyAlias=upload
   keyPassword=<password>
   ```
4. Play Console will ask for the upload key cert on first upload — the
   `jarsigner`/`keytool -list` SHA-1/SHA-256 fingerprints come from that file
   (`keytool -list -v -keystore keys/upload-keystore.p12 -alias upload`).

Regeneration (only if this key was never used / is compromised before first
upload): `scripts/generate-upload-key.py` (see its header).

---

## 6. Builds (GitHub Actions)

Workflow: **Android (MedRep Pro)** (`.github/workflows/android.yml`)

- Runs on PRs touching the app, pushes to `main`, and manually
  (**Actions → Android (MedRep Pro) → Run workflow**).
- **`medrep-pro-debug-apk`** artifact: install on your phone
  (enable "install from browser/files" once). Test ads show until §3 is done;
  Play purchases need a Play test track + licence tester (below).
- **`medrep-pro-release-aab`** artifact (only when §5 secrets/variable are
  set): upload this `.aab` to Play Console.

Local equivalents (need JDK 21 + Android SDK 36):

```bash
npm run android:sync          # web build + cap sync
npm run android:apk:debug     # android/app/build/outputs/apk/debug/
npm run android:aab:release   # signed when keystore configured (§5.3)
```

**Version bumps:** `package.json` version drives the in-app badge.
`android/app/build.gradle` `versionCode`/`versionName` must increase for
every Play upload — bump `versionCode` by 1 each release.

---

## 7. Play Console setup + the 12-tester / 14-day closed test

1. **Create app**: MedRep Pro · package `in.medrepconnect.app` · Free ·
   declarations (privacy policy URL = the live privacy page; ads = **Yes**;
   target audience **18+**; Data safety per `store-listing/data-safety.md`;
   content rating questionnaire → expect Teen/18+ employment category).
2. **Store listing**: `store-listing/` texts, icon, feature graphic, and the
   four **real** screenshots (its README lists the exact scenes — templates
   must not be submitted).
3. **Closed testing (required before production for new personal accounts):**
   - Create a **Closed track → Alpha** (or "Closed testing") release with the
     release AAB; add the one-time products (§4) as Active — they are
     testable in this track; add your own email under **Licence testing**
     (Setup → Licence testing) so purchases are free test charges.
   - Recruit **at least 12 testers** (Google requires ≥12 for 14 days for new
     personal developer accounts), add their emails (or a Google Group),
     share the opt-in link, and have every tester **opt in and keep the app
     installed**.
   - Keep that closed test running for **14 consecutive days** with the app
     available to all 12+ testers. Google counts from when testers opted in;
     check **Dashboard → closed test status** for the timer.
   - During the test: exercise the reviewer flow (store-listing/reviewer-notes.md),
     confirm the unlock video grants company names, a test purchase activates
     within seconds, and a Play refund (Play Console → Orders → Refund) marks
     the payment refunded (after the app re-checks / the void poll runs).
4. **Reviewer test login:** before submitting, create the demo account noted
   in `store-listing/reviewer-notes.md` and paste its credentials into Play
   Console's app-access instructions. Never commit real credentials.
5. **Production release:** after the 14-day/12-tester gate shows complete,
   promote the closed-test build (or upload a fresh AAB with a bumped
   `versionCode`) to Production, complete the listing + declarations, and
   submit for review. India distribution: ensure the app is available in
   **India** (Production → Countries/regions) and that pricing is in INR.

### Pre-submit checklist

- [ ] §2 SQL run (both files) and functions deployed; `verify_jwt` OFF only for `admob-reward-verification`
- [ ] Secrets `ADMOB_REWARDED_AD_UNIT_ID` (real value at launch) and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` set
- [x] Real AdMob **App ID** in Manifest + `adConfig.ts`; real `pub-` ID in `public/app-ads.txt`
- [x] Real Banner + Rewarded **ad unit IDs** in `adConfig.ts` (Banner `…/2527533866`, Rewarded `…/4112078274`)
- [ ] Supabase secret `ADMOB_REWARDED_AD_UNIT_ID` set to the real rewarded unit + SSV callback URL set on that unit (§2c/§2d)
- [ ] 7 Play products Active and priced; licence tester added
- [ ] `subscribed_until` visually checked after a test purchase; refund path tested
- [ ] Privacy policy URL opens over HTTPS
- [ ] Real screenshots replace templates; demo reviewer login works (free plan)
- [ ] `versionCode` bumped; release AAB uploaded from the GitHub artifact
