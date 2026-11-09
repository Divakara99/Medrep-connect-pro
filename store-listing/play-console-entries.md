# Play Console — manual entries for 1.0.4 (versionCode 6)

Everything on this page has to be typed into Play Console by hand. Nothing here
is applied by a code push. Work top to bottom; each block is copy-paste ready.

Upload artifact: **`medrep-pro-release-aab`** from the Android workflow run for
the release commit (Play → Release → Production → Create new release → Upload).

---

## 1. Release → "What's new" (Release notes)

Two languages are on the listing, so paste **one tagged block per language**.
Untagged text is rejected with *"Line 1: text outside language tags"*. No blank
line before the first tag, and close every tag.

**English (India):**

```
<en-IN>
• Filter jobs by city and HQ, and pick the experience you have. The salary filter has been removed.
• Your profile now saves to your account, so it is there on any phone you sign in with.
• Small fixes to notifications and the sign-in screen.
</en-IN>
```

**Hindi (India)** — if the second language is English (United States), paste the
English block again inside `<en-US>` instead:

```
<hi-IN>
• अब नौकरियाँ शहर और HQ से छाँटें, साथ में अपना अनुभव चुनें। सैलरी फ़िल्टर हटा दिया गया है।
• आपकी प्रोफ़ाइल अब आपके अकाउंट में सेव होती है, इसलिए किसी भी फ़ोन पर उपलब्ध रहती है।
• नोटिफ़िकेशन और साइन-इन स्क्रीन में छोटे सुधार।
</hi-IN>
```

---

## 2. Store listing → text fields

| Field | Value | Limit |
|---|---|---|
| App name | `MedRep Pro` | 30 |
| Short description | paste `store-listing/short-description.txt` → *MR & pharma jobs across India. Unlock a company free, or subscribe.* (67 chars) | 80 |
| Full description | paste `store-listing/full-description.txt` (2,568 chars — rewritten for the City/HQ filters and the salary-filter removal) | 4000 |
| Contact email | `mglover961994@gmail.com` | — |
| Privacy policy | `https://medrepconnect.in/privacy-policy.html` | — |

The full description changed in this release: it now says **"Search and filters
by city, HQ, category and experience"** and no longer promises a salary filter.
Re-paste it, otherwise the listing keeps advertising a filter that is gone.

---

## 3. App content → declarations (answer once, they carry forward)

| Page | Answer |
|---|---|
| **Ads** ("Does your app contain ads?") | **Yes** — AdMob banner + optional rewarded videos |
| **In-app purchases** | **Yes** — one-time pass products |
| **App access** | All functionality available without credentials, except the manager contact block, which needs a purchased pass. Add the test account from `store-listing/reviewer-notes.md` so a reviewer can see a subscribed state. |
| **Content rating** | Category **Utility / Productivity** (or Business); answer **Yes** to "does the app share user location" only if asked about approximate location from the ads SDK; **No** to violence, sex, profanity, gambling, drugs, and user-generated content shared publicly (support messages are private, one-to-one) |
| **Target audience** | **18 and over**; do not opt in to Designed for Families |
| **News app** | **No** |
| **Data safety** | Use `store-listing/data-safety.md`. No new data types this release: the profile moved from the browser to our database, which was already declared as *Profile → collected, not shared* |
| **Data deletion** | In-app: Menu → Account → support request, or email `mglover961994@gmail.com`. Account deletion removes account, profile, resume, unlocks and application history |
| **Government app** | **No** |
| **Financial features** | **No** — the app sells its own passes only, through Google Play |

If the Data safety form is already submitted and unchanged, use **"Edit" → save**
so it re-confirms against the new AAB; Google re-checks declarations on upload.

---

## 4. Monetise → Products → In-app products (one-time)

These must exist and be **Active** before the release is reviewed, with the same
product IDs the app asks Play for. Price in Play Console is what the Android app
shows — the website price comes from the Admin → Plans table and is separate.

| Product ID | What the user gets | Price to keep in Play Console |
|---|---|---|
| `medrep_pass_5d` | 1 day | ₹19 |
| `medrep_pass_10d` | 10 days | ₹99 |
| `medrep_pass_15d` | 15 days | ₹149 |
| `medrep_pass_30d` | 30 days | ₹249 |
| `medrep_pass_90d` | 90 days | ₹599 |
| `medrep_pass_180d` | 180 days | ₹999 |
| `medrep_pass_365d` | 365 days | ₹1,799 |

- Every one is a **one-time product**, not a subscription — passes add their days
  to the current expiry and nothing auto-renews.
- Do not add a ₹5 product: Play India's minimum is ₹10. The ₹5 single-job unlock
  is not a Play product at all — the app opens Razorpay Checkout for it, on the
  website and in the Android app alike. Under Google's payments policy that is
  only allowed inside the app through the **User Choice Billing** programme
  (Play Console → Monetise → Payments), so enrol there before submitting this
  build. `ANDROID_IN_APP_JOB_UNLOCK` in `src/data/jobUnlock.ts` switches the
  in-app ₹5 button off.
- After changing any price, re-check the Plans screen in a **closed test** build:
  the app displays Play's `priceString`, so a stale price means Play has not
  propagated the change yet.

---

## 5. Release → review and rollout

1. **Release name**: `1.0.4 (vc6)`.
2. **Upload** the release AAB; confirm Play shows versionCode **6**.
3. **Release notes**: paste section 1 for each language.
4. **Rollout**: staged 20% → 50% → 100%, or full if you want the filter change out
   quickly. 1.0.3 (vc5) stays available for anyone rolling back.
5. After it goes live, install from Play Store on a device that had the old build
   **uninstalled first**, open Menu → Account and check the build stamp shows
   **1.0.4 (6)** before judging anything else.

---

## 6. Things that do NOT need a Play Console entry

- The AdMob App ID, banner, rewarded and interstitial unit IDs are in the build.
- `app-ads.txt` is served from `https://medrepconnect.in/app-ads.txt`.
- The Supabase keys, Edge Functions and pricing tables are server-side.
- The website keeps Razorpay/UPI and shows no ads — nothing on this page affects it.
