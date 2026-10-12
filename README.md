# MedRep Connect Pro & Multi-Industry Job Hub

India's first pharma-job network — **MR vacancies pinned first**, then multi-industry jobs (ABM, FMCG, E-commerce, Finance, Banking, IT, Healthcare, Insurance, Part-time, Field).

**Creator (frozen):** M DIVAKAR REDDY · Business Development Manager

## Stack
- **React 19 + TypeScript**
- **Vite 8** (dev server, build)
- **Tailwind CSS 4** (via `@tailwindcss/vite`)
- Single-file PWA (`manifest.json` + `sw.js`)
- Supabase Auth for account identity and sessions
- Supabase RLS + a server-side job projection for vacancies; other legacy demo/profile/ticket data remains device-local until migrated

## Auth
- Supabase Auth provides account creation, sign-in, persisted sessions, email password recovery, and sign-out.
- The former localStorage username/password store (which contained plaintext demo passwords) is removed on startup; old local demo accounts must be recreated or migrated out-of-band.
- **Admin sign-in:** the public login screen does not advertise the admin route. Administrators can tap the brand logo/name five times within four seconds or use a privately bookmarked `/?portal=admin` URL. This is convenience, not a secret or access control; the trusted `app_metadata.role = "admin"` claim and RLS enforce authorization. The normal login rejects admin accounts; the admin portal requires verified TOTP MFA (`aal2`) before showing data.
- Admin accounts must be provisioned and promoted by a trusted Supabase administrator; see the Supabase setup below.

## User app
- **Home** — search, filters, hero, MR-first feed, live stats.
- **Priority** — pinned jobs + horizontally scrollable category filters.
- **Plans** — every tier (5/10/15/30/90/180/365 days) stays selectable. Prices and durations come from the server catalog (`public.billing_plans`); Razorpay Checkout is the only payment path and shows whichever methods the merchant account has enabled. Legacy manual UPI requests remain reviewable by an admin.
- **Resume** — private resume upload (PDF/DOC/DOCX, ≤ 2 MB) plus the user's application history. Files go to a private Supabase Storage bucket, are readable only by their owner, and are deleted after 30 days. Uploading never navigates away from the screen.
- **Account** — fixed tagline **Job Seeker**; full profile editor (personal · education · experience).
- **Job detail** — role, **city**, HQ, division, salary, experience, posted date and the point-wise description are visible to every signed-in user and are never blurred. Exactly five fields are sent only to active subscribers — company name, manager name, manager email, primary contact number and the optional (+) manager alternate number; free users see blurred placeholders instead of values. Apply is locked for free users.
- **AI chat** — answers pricing/jobs questions; hard issues automatically escalate to admin tickets.
- **PWA** — `manifest.json` + service worker (`/sw.js`) for installable offline shell.

## Free vs. Subscribed
| Free | After subscribe |
| --- | --- |
| Role, **city**, HQ, division, salary, experience, category, posted date and description visible | Company name, manager name, manager email, contact number and the (+) alternate number unlocked |
| Confidential fields shown as blurred placeholders — their values are never sent | Values are sent, then blurred until tapped (anti-shoulder-surfing) |
| Apply blocked — "Subscribe to apply" | Apply + confirmation sheet enabled |

## Admin panel (full access)
Horizontally scrollable tabs: **Vacancies · Plans · Payments · Tickets · Users · Profile**
- **Vacancies** — add / edit / delete / pin priority (MR, ABM, multi-industry).
- **Plans** — edit titles, taglines, popularity, **checkout prices and validity**; every change is written to `public.billing_plans` by `save_billing_plan()`, which the database only accepts from an MFA-verified administrator. Existing orders keep the price they were created with.
- **Vacancies** — the description field is marked PUBLIC, previews its (+) bullets as you type, and refuses phone numbers and email addresses (mirrored by a database trigger).
- **Payments** — server-backed transaction monitor; legacy manual UPI requests require bank-statement review before activation. Razorpay credentials and merchant banking details never go in the browser and are never shown to users.
- **Tickets** — AI-escaped and manual support tickets with replies & status.
- **Users** — Auth-backed registered-user list; delete non-admin accounts through the verified server-side Edge Function (administrator accounts are protected).
- **Profile** — frozen creator identity + hidden admin mobile.

Only an authenticated admin with verified MFA can post/edit/delete vacancies (enforced by Supabase RLS). No demo jobs are shipped to user browsers; admins can explicitly import older local posts after review.

## Data (localStorage keys)
| Concept | Key |
| --- | --- |
| Supabase Auth session | `mrc_supabase_auth_v1` (managed by Supabase Auth) |
| Admin account cache | `mrc_admin_users_cache_v1` |
| Jobs | Supabase `vacancies` (old `mrc_jobs_v1` may be imported by an admin; cleared for users) |
| Plans | Server only (`public.billing_plans`); old `mrc_plans_v1` is removed |
| Resumes | Server only — private Supabase Storage bucket + `resume_documents`; old `mrc_resume_v1*` is removed |
| Applications | Server only (`public.applications` via `record_application`) |
| Tickets | `mrc_tickets_v1` |
| Payment records | Server only; old `mrc_verified_payment_cache_v1` is removed |
| Merchant payment details | Not stored — old `mrc_alt_payment_v1` is removed |
| User bios / profiles | `mrc_profiles_v1` |

The obsolete `mrc_users_v1`, `mrc_session_v1`, `mrc_user_state_v1`, simulated payment history, and saved payment methods are cleared at startup. Old plaintext passwords, simulated entitlements, and any Razorpay secret once entered in the old Admin form are never imported or trusted.

## Supabase Auth and database security

Accounts and sessions use Supabase Auth (`@supabase/supabase-js`); localStorage is no longer an authentication source. The browser contains only the Supabase URL and publishable/anon key, which are public by design. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` override the public defaults in `src/data/supabase.ts` at build time.

### One-time Supabase setup

1. In Supabase, enable email/password Auth and configure the app URL plus allowed redirect URLs for the production site and local development. Email confirmation can remain enabled; new users then verify before signing in.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL Editor. It creates the Auth-backed `user_accounts` projection and existing mirror tables, adds database-enforced normalized Indian mobile uniqueness, installs the Auth sync trigger, and applies admin-only RLS. The script removes legacy policies on the eight mirror tables (including the old `mirror_all` policy) and creates policies for `authenticated` sessions whose **trusted** `app_metadata.role` is `admin` (or `app_metadata.is_admin` is `true`). It creates no `anon` policies. Account records are readable by admins but cannot be changed/deleted directly by browser clients. The dashboard views (`users_view`, `payments_view`, `vacancies_view`, `applications_view`) are dropped and recreated, never `CREATE OR REPLACE`d, so re-running the script over an older view shape cannot fail with SQLSTATE `42P16` (`cannot change name of view column …`) before the viewers' `authenticated`-only grants are reapplied. The script is safe to re-run. The later billing migration adds a separate SELECT policy so each signed-in user can read only their own subscription expiry.
3. Enable TOTP MFA in Supabase Auth settings before deploying this version. The admin portal provides authenticator enrollment and a six-digit verification step; admin-only RLS requires both the trusted role and an `aal2` JWT. Create the owner account `akhildivakara@gmail.com` in **Authentication → Users** before the first run (or re-run the script after creating it). The script promotes that account for you by merging `role: admin` into the **trusted** `raw_app_meta_data` and setting its display name to `M Divakar Reddy`; the Auth sync trigger then refreshes `user_accounts.name`/`is_admin`. Sign out and back in so the new role claim is present in the Auth token. Set the password privately in Supabase Auth — no password is stored in SQL or in the repository. To promote a *different* address, edit the email literal in the final `DO` block (or run the equivalent `UPDATE auth.users … WHERE lower(email) = lower('…')` yourself). Never put an admin password or service-role key in the frontend or `VITE_*` variables. Do not grant admin through `user_metadata`, which users can edit themselves.
4. Deploy `admin-delete-user` and `review-manual-upi-payment` Edge Functions from this repository. Both require a verified administrator MFA token; account deletion reads `SUPABASE_SERVICE_ROLE_KEY` only server-side. Never put that key in the frontend.
5. Run [`supabase/payments.sql`](supabase/payments.sql) after `schema.sql`, then run [`supabase/secure_jobs.sql`](supabase/secure_jobs.sql) **before deploying the new frontend**. The job RPC exposes a public-field projection (including the point-wise description) to signed-in free users, and confidential fields only to active subscribers. Direct `vacancies` access remains admin-only, and a trigger rejects contact details in the public description. Without this SQL the job feed fails closed instead of showing browser-held secrets. Payment capture and plan activation remain server-side.
6. Run [`supabase/admin_mfa.sql`](supabase/admin_mfa.sql), [`supabase/billing_plans.sql`](supabase/billing_plans.sql), [`supabase/resumes.sql`](supabase/resumes.sql) and [`supabase/applications.sql`](supabase/applications.sql) for this release: the authenticator (`aal2`) gate, the server pricing catalog, private resume storage with 30-day retention, and server-side application records. [`DEPLOY.md`](DEPLOY.md) has the full ordered rollout, the pre-flight description check and the `pg_cron` resume purge.
7. In Supabase **Project Settings → Edge Functions → Secrets**, set both `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to a matching test or live pair from the same Razorpay account. Set `RAZORPAY_WEBHOOK_SECRET` separately. Enter private secrets only in Supabase's secure secrets UI or CLI, never in chat, the repository, Netlify `VITE_*` variables, or the browser.
8. Deploy `create-razorpay-order` (prices orders from `public.billing_plans`), `verify-razorpay-payment`, `razorpay-webhook`, and `create-upi-intent` (now returns 410 and no VPA) with `supabase functions deploy <function-name>`. Configure the Razorpay webhook URL as `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook` and subscribe to `payment.captured`; use the same webhook secret as the `RAZORPAY_WEBHOOK_SECRET` Edge Function secret.

The SQL normalizer treats `9876543210`, `09876543210`, and `+91 98765 43210` as the same phone number. A unique partial index is the enforcement point for signup and profile changes; browser checks are only validation. On account deletion, Supabase Auth deletes the account projection by foreign-key cascade and the trigger scrubs legacy identity/profile mirror rows.

Jobs are server-backed; profiles, tickets, applications and notifications still have legacy device-local behavior and must not contain data requiring cross-device confidentiality until separately migrated. Paid subscription expiry and the subscription payment ledger are server-owned; clients can read their own records but cannot write or activate a plan. The admin payment monitor reads the protected payment table, and manual UPI activation requires a trusted admin to match the UTR against the bank statement. Razorpay key secrets remain only in Supabase Edge Function Secrets.

**Local-account migration:** existing `mrc_users_v1` entries contained plaintext passwords. The app deletes that key and the old `mrc_session_v1` on startup instead of trusting/importing them. Users must create Supabase Auth accounts; if existing account migration is required, do it through a controlled server-side import with a password-reset flow.

## Important source files
```
src/App.tsx                 — shell, auth gate, overlays, checkout glue
src/data/creator.ts         — frozen admin identity
src/data/auth.ts            — register / login / session / server subscription expiry
src/data/jobs.ts            — jobs, categories, filters, sorting, stats
src/data/plans.ts           — server billing catalog (read + admin save)
src/data/resume.ts          — private resume storage (upload / signed download / delete)
src/data/mfa.ts             — administrator TOTP enrolment and verification
src/data/payments.ts        — server-backed payment history and admin UPI review
src/data/tickets.ts         — support tickets
src/data/profile.ts         — Job Seeker bio + education/experience
src/data/storage.ts         — safe localStorage helpers
src/screens/*               — Login, Admin, Home, Priority, Plans, Account, AI
src/components/*            — JobCard (blur), ProfileEditor, PostVacancy, ui primitives
src/assets/logo.svg         — single source of truth for the brand mark
scripts/generate-icons.mjs  — derives favicon + all PWA icons from that SVG
public/manifest.json, sw.js — PWA
```

## Branding & app icons (one source of truth)
`src/assets/logo.svg` is the only place the brand mark is drawn:
- `src/components/Logo.tsx` imports it directly, so the in-app logo **is** the file.
- `npm run icons` re-renders it into `public/favicon.svg`, `icon-192.png`,
  `icon-512.png`, `apple-touch-icon.png` (full-bleed, iOS masks it) and
  `maskable-512.png` (glyph inside the Android safe zone).
- `public/manifest.json` and `index.html` reference those generated files only.

Edit the artwork in `logo.svg`, run `npm run icons`, and commit the output —
the favicon, the installed PWA icon and the in-app logo can never drift apart.
Rasterising uses `@resvg/resvg-js` (no system fonts), so output is identical
on any machine, including CI.

## App version in the UI
The release version lives once, in `package.json` → `"version"`. `vite.config.ts`
injects it at build time as `__APP_VERSION__`, and `src/data/version.ts` exposes
`APP_VERSION_LABEL` (e.g. `v1.0.0`), shown on the login screen, the account
screen and the admin header. Bumping `package.json` updates every badge —
nothing else to touch.

## Payment and other integrations
- Razorpay checkout and server-side verification are implemented, but live payments remain unavailable until the Supabase billing migration, Edge Functions, and secure Razorpay secrets/webhook are configured and deployed. The app never activates access based on a browser success screen.
- Direct UPI submissions stay pending until an admin verifies the transaction in the merchant bank account; a user-entered UTR alone is not proof of payment.
- Password-reset email delivery depends on the Supabase Auth email provider configuration.

## Run locally
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
npm run test:security  # isolated Postgres tests for free/paid/expired job projections
npm run icons    # regenerate favicon + PWA icons from src/assets/logo.svg
npm run preview  # preview production build
```

## Quick test paths
1. **User:** Create account → Account shows **Job Seeker** → edit profile → browse the public job projection → choose a plan → pay in Razorpay → wait for server verification → Apply. UPI app/QR availability depends on Razorpay merchant settings and device support; never send a transfer to a merchant ID shown outside checkout.
2. **Admin:** Provision a Supabase Auth user with the trusted admin `app_metadata` claim → open `/?portal=admin` → sign in → Admin panel (users, verified payments, UPI review, and scrollable tabs).
