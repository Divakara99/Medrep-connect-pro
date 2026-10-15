# Play Console — Data safety answers (MedRep Pro, in.medrepconnect.app)

Fill **Play Console → App content → Data safety** with these answers. They match
`public/privacy-policy.html`; update both together if a feature changes.

## Overview

- **Does the app collect or share user data?** Yes (collect; share only with processors below).
- **Is data encrypted in transit?** Yes (HTTPS everywhere; Supabase + Google).
- **Can users request data deletion?** Yes — in-app support request; account deletion removes
  account, profile, resume, unlocks and application history (see also the account-deletion URL:
  use the privacy-policy URL + support email until a dedicated page exists).
- **Data types are declared for:** account, profile, resume, job activity, support messages,
  advertising ID (Google AdMob SDK), purchase history (Google Play).

## Data types

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Name, email | Yes | No (processor: Supabase hosting only) | No | Account management |
| Phone number | Yes | No | Yes | Account management (one account per mobile), app functionality |
| Resume / files | Yes | No | Yes | App functionality (applying); auto-deleted after 30 days |
| Profile (education, experience) | Yes | No | Yes | App functionality |
| App activity (jobs viewed/applied, company unlocks) | Yes | No | No | App functionality, analytics (first-party) |
| Support messages | Yes | No | Yes | App functionality (support) |
| Advertising ID & device/diagnostic data (AdMob SDK) | Yes (by Google AdMob SDK) | Yes — Google (advertising) | n/a | Advertising, ads measurement |
| Purchase history (product, token hash, order ID, expiry) | Yes | Yes — Google Play (payments) | n/a | App functionality (entitlement), fraud prevention. Raw purchase tokens and card/bank details are NEVER stored |
| Approximate location (IP-based, via AdMob) | Yes (SDK) | Yes — Google | n/a | Advertising |

## Declarations

- **Contains ads:** **Yes** (also answer Yes on the separate "Ads" declaration page).
- **Target audience:** 18+ (see ANDROID.md — job seekers; not directed at children; TFUA off).
- **News / COVID / government app:** No. **Financial features:** No (job listings only;
  payments are for the app's own passes through Google Play).
- **Privacy policy URL:** `https://medrepconnect.in/privacy-policy.html`
  (live after the next Netlify deploy — verify it opens before submitting).

## Account deletion URL (App content → Data deletion)

Point it at the privacy policy page and state the in-app route:
"Account → ask support / email support" — or host a dedicated instruction page before release
if a reviewer asks. In-app support already reaches the admin who can delete the account
(admin-delete-user Edge Function).
