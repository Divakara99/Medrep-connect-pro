# MedRep Connect Pro & Multi-Industry Job Hub

India's first pharma-job network — **MR vacancies pinned first**, then multi-industry jobs (ABM, FMCG, E-commerce, Finance, Banking, IT, Healthcare, Insurance, Part-time, Field).

**Creator (frozen):** M DIVAKAR REDDY · Business Development Manager

## Stack
- **React 19 + TypeScript**
- **Vite 8** (dev server, build)
- **Tailwind CSS 4** (via `@tailwindcss/vite`)
- Single-file PWA (`manifest.json` + `sw.js`)
- Supabase Auth for account identity and sessions
- `localStorage` for device-local demo/app state, with an admin-authenticated Supabase mirror for selected records

## Auth
- Supabase Auth provides account creation, sign-in, persisted sessions, email password recovery, and sign-out.
- The former localStorage username/password store (which contained plaintext demo passwords) is removed on startup; old local demo accounts must be recreated or migrated out-of-band.
- **Admin sign-in:** tap the **MedRep logo 5 times**, then sign in with a Supabase Auth account carrying the trusted `app_metadata.role = "admin"` claim. The app bundle contains no admin password, and user-editable metadata never grants admin access.
- Admin accounts must be provisioned and promoted by a trusted Supabase administrator; see the Supabase setup below.

## User app
- **Home** — search, filters, hero, MR-first feed, live stats.
- **Priority** — pinned jobs + horizontally scrollable category filters.
- **Plans** — 5/10/15/30/90/180/365 day tiers; simulated Razorpay / UPI checkout.
- **Account** — fixed tagline **Job Seeker**; full profile editor (personal · education · experience).
- **Job detail** — company/manager/contact blurred until subscribed; Apply locked for free users.
- **AI chat** — answers pricing/jobs questions; hard issues automatically escalate to admin tickets.
- **PWA** — `manifest.json` + service worker (`/sw.js`) for installable offline shell.

## Free vs. Subscribed
| Free | After subscribe |
| --- | --- |
| Role, location, salary, category visible | Company, manager, contact fully unlocked |
| Apply blocked — "Subscribe to apply" | Apply + confirmation sheet enabled |

## Admin panel (full access)
Horizontally scrollable tabs: **Vacancies · Plans · Payments · Tickets · Users · Profile**
- **Vacancies** — add / edit / delete / pin priority (MR, ABM, multi-industry).
- **Plans** — edit titles, prices, taglines, popularity.
- **Payments** — Razorpay key + webhook secret, UPI VPA; **Save → saved methods list** (Load / Default / Delete).
- **Tickets** — AI-escaped and manual support tickets with replies & status.
- **Users** — Auth-backed registered-user list; delete non-admin accounts through the verified server-side Edge Function (administrator accounts are protected).
- **Profile** — frozen creator identity + hidden admin mobile.

Only admin can post vacancies.

## Data (localStorage keys)
| Concept | Key |
| --- | --- |
| Supabase Auth session | `mrc_supabase_auth_v1` (managed by Supabase Auth) |
| Admin account cache / local demo entitlement | `mrc_admin_users_cache_v1`, `mrc_user_state_v1` |
| Jobs | `mrc_jobs_v1` |
| Plans | `mrc_plans_v1` |
| Tickets | `mrc_tickets_v1` |
| Payments + saved methods | `mrc_payments_v1`, `mrc_payment_methods_v1` |
| User bios / profiles | `mrc_profiles_v1` |

The obsolete `mrc_users_v1` and `mrc_session_v1` keys are deleted at startup; the old plaintext passwords are never imported into Supabase.

## Supabase Auth and database security

Accounts and sessions use Supabase Auth (`@supabase/supabase-js`); localStorage is no longer an authentication source. The browser contains only the Supabase URL and publishable/anon key, which are public by design. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` override the public defaults in `src/data/supabase.ts` at build time.

### One-time Supabase setup

1. In Supabase, enable email/password Auth and configure the app URL plus allowed redirect URLs for the production site and local development. Email confirmation can remain enabled; new users then verify before signing in.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL Editor. It creates the Auth-backed `user_accounts` projection and existing mirror tables, adds database-enforced normalized Indian mobile uniqueness, installs the Auth sync trigger, and applies admin-only RLS. The script removes legacy policies on the eight mirror tables (including the old `mirror_all` policy) and creates policies for `authenticated` sessions whose **trusted** `app_metadata.role` is `admin` (or `app_metadata.is_admin` is `true`). It creates no `anon` policies. Account records are readable by admins but cannot be changed/deleted directly by browser clients. The dashboard views (`users_view`, `payments_view`, `vacancies_view`, `applications_view`) are dropped and recreated, never `CREATE OR REPLACE`d, so re-running the script over an older view shape cannot fail with SQLSTATE `42P16` (`cannot change name of view column …`) before the viewers' `authenticated`-only grants are reapplied. The script is safe to re-run.
3. Create the owner account `akhildivakara@gmail.com` in **Authentication → Users** before the first run (or re-run the script after creating it). The script promotes that account for you by merging `role: admin` into the **trusted** `raw_app_meta_data` and setting its display name to `M Divakar Reddy`; the Auth sync trigger then refreshes `user_accounts.name`/`is_admin`. Sign out and back in so the new role claim is present in the Auth token. Set the password privately in Supabase Auth — no password is stored in SQL or in the repository. To promote a *different* address, edit the email literal in the final `DO` block (or run the equivalent `UPDATE auth.users … WHERE lower(email) = lower('…')` yourself). Never put an admin password or service-role key in the frontend or `VITE_*` variables. Do not grant admin through `user_metadata`, which users can edit themselves.
4. Deploy the account-deletion Edge Function from this repository with the Supabase CLI: `supabase functions deploy admin-delete-user`. The hosted function reads `SUPABASE_SERVICE_ROLE_KEY` only from its server environment. It verifies the caller's Auth JWT and protected admin claim, rejects self/admin deletion, and uses the Auth Admin API. Never commit or expose that key.

The SQL normalizer treats `9876543210`, `09876543210`, and `+91 98765 43210` as the same phone number. A unique partial index is the enforcement point for signup and profile changes; browser checks are only validation. On account deletion, Supabase Auth deletes the account projection by foreign-key cascade and the trigger scrubs legacy identity/profile mirror rows.

The app's other job, plan, payment, ticket, application, and notification data still has the existing local-first/demo behavior. Selected mirror writes are sent only while a Supabase Auth session has the trusted admin role; ordinary user sessions cannot write the admin-only mirror and never fall back to anonymous writes. The account list is read from `user_accounts` under RLS. Saved payment methods (which may contain gateway secrets) remain local. The Admin dashboard's cloud card reports mirror request status.

**Local-account migration:** existing `mrc_users_v1` entries contained plaintext passwords. The app deletes that key and the old `mrc_session_v1` on startup instead of trusting/importing them. Users must create Supabase Auth accounts; if existing account migration is required, do it through a controlled server-side import with a password-reset flow.

## Important source files
```
src/App.tsx                 — shell, auth gate, overlays, checkout glue
src/data/creator.ts         — frozen admin identity
src/data/auth.ts            — register / login / session / subscribe
src/data/jobs.ts            — jobs, categories, filters, sorting, stats
src/data/plans.ts           — plan matrix
src/data/payments.ts        — Razorpay/UPI config + saved methods list
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

## Remaining demo integrations
- Checkout is simulated; there are no real Razorpay webhooks.
- Password-reset email delivery is not connected.

## Run locally
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
npm run icons    # regenerate favicon + PWA icons from src/assets/logo.svg
npm run preview  # preview production build
```

## Quick test paths
1. **User:** Create account → Account shows **Job Seeker** → edit profile bio → browse (blurred jobs) → Plans → pay → unlock → Apply.
2. **Admin:** Provision a Supabase Auth user with the trusted admin `app_metadata` claim → login screen → **tap logo 5×** → sign in → Admin panel (users, account deletion, payments, and scrollable tabs).
