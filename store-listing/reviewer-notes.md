# Google Play reviewer notes (paste into Play Console → Review → instructions)

App: **MedRep Pro** (`in.medrepconnect.app`) — job listings for medical representatives (India).

## Test login (required — content is behind sign-in)

- A demo job-seeker account is required to pass the login screen. Create it just before
  submitting (Supabase → Authentication → Users, or sign up in the app), verify its email,
  and paste the credentials in the Play Console field — NEVER commit them to this repo:

  - **Email:** `<REVIEWER_DEMO_EMAIL>`
  - **Password:** `<REVIEWER_DEMO_PASSWORD>`

- The account starts on the FREE plan on purpose. To also check the paid view, either buy any
  pass in the closed-test track (test cards are free there) or tell us — we can grant days to
  the demo account from our admin console.
- No OTP/SMS is needed. Password minimum is 6 characters.

## What to try

1. Sign in → Home: job cards show role/city/salary; company names are locked for free users.
2. On any locked job tap **"Watch video to unlock company name"** → a rewarded ad
   plays → that one job's company name unlocks permanently. Manager
   name/email/phone stay locked — that is intended, not a bug.
3. Open any job: city, HQ, division, salary, experience and the full description are visible
   without paying. **Apply** asks for a plan — intended.
4. Plans tab → choose a plan → payment is **Google Play Billing** (one-time pass). In test
   tracks use a Play test payment method; access activates after server verification
   (a few seconds). Refunds of Google Play purchases are handled by Google; a refunded pass
   may lose its remaining days.
5. Ads: a banner appears on Home/Priority/AI/Account — never on login, sign-up, password or
   payment screens. The app declares **Contains ads: Yes**. The app is for adults (18+) —
   it lists employment opportunities and collects resumes for applications.

## Notes

- The companion website (medrepconnect.in) is a separate channel with its own checkout
  and is **not** part of this Android review; inside the app there are no web payments,
  no external payment links, and no "pay on the website" prompts.
- Push notifications are not part of this release (declared permissions are minimal: Internet
  and the AdMob advertising-ID permission added by the SDK).
- Privacy policy (covers AdMob/advertising ID and Play purchases):
  https://medrepconnect.in/privacy-policy.html
