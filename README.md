# MedRep Connect Pro & Multi-Industry Job Hub

India's first pharma-job network — **MR vacancies pinned first**, then multi-industry jobs (ABM, FMCG, E-commerce, Finance, Banking, IT, Healthcare, Insurance, Part-time, Field).

**Creator (frozen):** M DIVAKAR REDDY · Business Development Manager

## Stack
- **React 19 + TypeScript**
- **Vite 8** (dev server, build)
- **Tailwind CSS 4** (via `@tailwindcss/vite`)
- Single-file PWA (`manifest.json` + `sw.js`)
- `localStorage` stand-in for Supabase (shapes match the planned Supabase schema)

## Auth
- Login screen is shown first — no app content until signed in.
- Users can **Create account**, **Sign in**, **Forgot password**, **Logout**.
- **Admin secret:** tap the **MedRep logo 5 times** on the login screen → admin login.
- No demo credentials published.

**Admin credentials (admin-only, never shown to users):**
- Email: `Akhildivakara@gmail.com`
- Password: `9959827826Dd@`
- Mobile: `9676728619` (admin panel only — no WhatsApp/calling from user app)

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
- **Users** — registered users list (no plaintext passwords surfaced).
- **Profile** — frozen creator identity + hidden admin mobile.

Only admin can post vacancies.

## Data (localStorage keys)
| Concept | Key |
| --- | --- |
| Users / session | `mrc_users_v1`, `mrc_session_v1` |
| Jobs | `mrc_jobs_v1` |
| Plans | `mrc_plans_v1` |
| Tickets | `mrc_tickets_v1` |
| Payments + saved methods | `mrc_payments_v1`, `mrc_payment_methods_v1` |
| User bios / profiles | `mrc_profiles_v1` |

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

## Not live backend yet
- Real Supabase integration (checkout is simulated; admin keys stored for later wiring).
- Real Razorpay webhooks.
- Real email delivery for password reset.

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
2. **Admin:** Login screen → **tap logo 5×** → admin credentials → panel (payments save list, multi-category posting, scrollable tabs).
