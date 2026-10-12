# 🚀 Deploy MedRep Connect Pro — Step-by-Step Guide

The app builds to a pure static bundle (`dist/`) — HTML, JavaScript, CSS, and
PWA files. It runs on any static host. The build uses relative paths
(`base: './'`), so it works at a domain root or in a sub-folder.

---

## Primary deployment — Netlify

Netlify is the production host for this app. The live site is
[https://medrepjob.netlify.app](https://medrepjob.netlify.app), deployed from
`main`. The repository's `netlify.toml` already sets the build command to
`npm run build`, the publish directory to `dist`, and Node.js to version 22.

### Connect or verify the Netlify site

1. In the Netlify dashboard, open the site for MedRep Connect Pro (or choose
   **Add new site → Import an existing project** and select
   `Divakara99/Medrep-connect-pro`).
2. Set the production branch to `main`.
3. Confirm the build command is `npm run build` and the publish directory is
   `dist` (these are already configured in `netlify.toml`).
4. Netlify builds and deploys each new commit to `main`. Use the site's
   **Deploys → Trigger deploy** action to redeploy manually if needed.

The GitHub Actions workflow in `.github/workflows/ci.yml` only checks pull
requests and pushes to `main`; it does not deploy the site.

For a one-off manual Netlify deploy, run `npm run build`, then drag the
resulting `dist` folder into Netlify's manual deploy area. For regular
production updates, keep the GitHub integration connected so deploys follow
`main` automatically.

---

## Optional alternative — Vercel

1. Go to <https://vercel.com> → **Add New → Project** → import the GitHub repo.
2. Vercel auto-detects Vite — click **Deploy**.
3. Every push to `main` can auto-deploy. A free `*.vercel.app` domain is
   included.

---

## Manual deployment to another static host

1. Run `npm run build`.
2. Upload the entire `dist/` folder to `public_html` (cPanel) or your server.
3. No server code is needed.

---

## Local production preview (test before deploying)

```bash
npm run build
npm run preview      # serves the exact production build
```

---

## Required before the secure jobs frontend goes live

**Coordinate these changes in a short maintenance window.** The new app has
no client-side demo jobs; without the migration it shows a jobs-unavailable
message rather than exposing private details. The new admin portal requires a
verified TOTP authenticator; existing password-only admin sessions are denied
once the SQL is applied. Do not run the migration and leave the old frontend
live for an extended period.

1. Back up the production `public.vacancies` table. If old posts exist only in
   the admin browser's `mrc_jobs_v1` localStorage, **do not clear that admin
   browser's site data yet**; its Vacancies tab offers a review/import button.
   Check for sample posts before importing. If no rows exist, an admin must
   post vacancies after the new frontend is live.
2. Enable **TOTP MFA** for app users in Supabase Auth settings. Admins will
   scan a fresh authenticator QR inside the new admin portal on first sign-in;
   keep the setup key/code private (never screenshot it). Configure a strong
   server-side password policy (12+ characters), email confirmation, rate
   limits and breached-password checks in Supabase Auth. The frontend alone
   cannot enforce Auth settings.
3. Deploy the updated `admin-delete-user` and
   `review-manual-upi-payment` Edge Functions, which refuse password-only
   administrator JWTs:
   ```bash
   npx supabase login
   npx supabase functions deploy admin-delete-user --project-ref <production-project-ref>
   npx supabase functions deploy review-manual-upi-payment --project-ref <production-project-ref>
   ```
   Keep your Supabase login and API secrets private. Do not paste tokens here.
4. In Supabase SQL Editor for the SAME project used by `VITE_SUPABASE_URL`,
   apply `supabase/schema.sql` (if not already applied), then
   `supabase/payments.sql` (reapply it if `schema.sql` was rerun), then
   **`supabase/secure_jobs.sql`**. It enforces an `aal2` JWT alongside the
   trusted admin claim on all existing admin-only RLS policies and grants users
   only `list_visible_jobs()`. Private fields depend on server-owned expiry.
   Password-only admins can still enroll MFA through Supabase Auth but cannot
   read or change admin data. No service-role key goes into the browser.
5. Confirm the migration in SQL Editor:
   ```sql
   select to_regprocedure('public.list_visible_jobs()') as jobs_rpc,
          has_function_privilege('anon', 'public.list_visible_jobs()', 'EXECUTE') as anon_can_run;
   ```
   `jobs_rpc` must be non-null and `anon_can_run` must be `false`. The SQL
   Editor runs as an owner, so it cannot simulate a free user: test with two
   separate signed-in accounts in the app. A free user's Network response for
   `list_visible_jobs` must omit `company`, `manager`, `contact`,
   `managerEmail` and `description`; a paid user's response can include them.
   The raw `vacancies`/`vacancies_view` API must not return rows to a free user.
6. Merge the PR and wait for Netlify to publish the updated `main`. Open the
   admin portal via a privately bookmarked `/?portal=admin` URL or five taps
   on the login-page logo/name within four seconds. After your password,
   enroll an authenticator and verify its six-digit code. Existing verified
   factors prompt for a code on each new password-only session. Do not share
   admin passwords, QR/setup keys or one-time codes. The route is deliberately
   not linked on the public login page, but it is **not a secret**: trusted
   claims, verified MFA and RLS enforce authorization. Review/import older
   posts on the admin device if needed.
7. On user devices with older versions, clear site data/old PWA cache once,
   sign in again, and check jobs and payment flow. Previously delivered browser
   data cannot be retroactively hidden; never publish real confidential
   contacts in an old static bundle or public field (title, location, salary,
   experience or category).

Client-side 12-character password checks are a convenience, not a substitute
for your Supabase Auth policy. If an admin loses their authenticator, account
recovery must be performed by a trusted Supabase project owner using the Auth
Dashboard/admin tools; do not bypass the `aal2` RLS requirement or ask anyone
to share one-time codes. A hidden entry route is not MFA.

---

## Secure Razorpay and UPI billing setup

The browser only asks Supabase to create a server-priced order. Razorpay payment signatures and captured status are verified by Supabase Edge Functions before the server grants the selected plan's exact number of days. A renewal adds its validity after the current expiry. Checkout success on its own never activates access.

1. In Supabase SQL Editor, run `supabase/schema.sql` first, then run [`supabase/payments.sql`](supabase/payments.sql). The second script adds the protected server payment ledger and an own-account subscription-expiry read policy without changing the existing mirror schema.
2. In the **same Supabase project used by the app**, open **Edge Functions → Secrets** and explicitly set both `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to a matching pair from the same merchant account and mode (`rzp_test_…` for test, `rzp_live_…` for live). There is no built-in key ID fallback. Also set `RAZORPAY_WEBHOOK_SECRET` for captured-payment webhooks. The merchant UPI VPA is not needed for the new checkout flow. Revoke any key pair exposed in a screenshot before testing; never reuse it. Keep private secrets only in Supabase Edge Function secrets, not in chat, this repository, Netlify, or `VITE_*` variables.
3. Deploy these functions from the repository with the Supabase CLI: `create-razorpay-order`, `verify-razorpay-payment`, `razorpay-webhook` and `review-manual-upi-payment` (only for legacy requests). Redeploy `create-upi-intent` as a disabled endpoint so the previous deployed version can no longer return your VPA. The webhook is the only function configured without JWT verification; it verifies Razorpay's webhook HMAC itself. **Merging this code/Netlify deploying the website does not deploy Supabase functions.** For the order fix, after the change is merged, from the updated repository root run:
   ```bash
   npx supabase login
   npx supabase functions deploy create-razorpay-order --project-ref <production-project-ref>
   npx supabase functions deploy create-upi-intent --project-ref <production-project-ref>
   # If the webhook and verification functions are not yet deployed, deploy those too:
   npx supabase functions deploy verify-razorpay-payment --project-ref <production-project-ref>
   npx supabase functions deploy razorpay-webhook --project-ref <production-project-ref>
   # If you have older manual UPI requests to reconcile:
   npx supabase functions deploy submit-upi-utr --project-ref <production-project-ref>
   npx supabase functions deploy review-manual-upi-payment --project-ref <production-project-ref>
   ```
   Use the project ref shown in the Supabase dashboard for the project behind the site's `VITE_SUPABASE_URL`; authenticate privately via the CLI. Do not pass payment credentials on the command line. The deploy bundles `supabase/functions/_shared/razorpay.ts` with the function. In Edge Functions, confirm the new deployment, retry once with matching **test** credentials, and check the `create-razorpay-order` logs if it still fails: they now include only Razorpay's HTTP status and a validated error code (or `unavailable`). Don't retry live payments until the exposed pair is revoked and the fix is deployed.
4. In the Razorpay Dashboard, add the webhook URL `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook` and subscribe to `payment.captured`. Set the webhook secret there to the same value saved as `RAZORPAY_WEBHOOK_SECRET` in Supabase.
5. Test in Razorpay test mode first, including failed payments, captured payments, duplicate callbacks, and plan renewals. Only then switch the Supabase secrets to the live key pair and enable live payments.

Razorpay Checkout displays the payment methods enabled for your merchant account/device: cards (credit/debit), netbanking, and enabled UPI apps. Razorpay-managed QR is available only when Razorpay enables it for the merchant and checkout device; this app does not generate an unverified merchant-VPA QR or expose the merchant UPI ID. Enable UPI/QR and card methods in the Razorpay dashboard as needed. Existing manual UPI rows remain reviewable by admins against bank statements; users with an already-created pending request can submit a bank-generated UTR without seeing the VPA. No new manual UPI request can be created after the disabled `create-upi-intent` function is deployed. Never approve a typed UTR without a matching bank credit. The database already computes expiry atomically as `greatest(now(), current_expiry) + plan_days`; the UI displays date and time and rechecks on return to the app. Netlify publishes the frontend when `main` changes, but **does not deploy Edge Functions**.

**Security scope:** Payment activation and expiry are server-verified; the new job RPC enforces server-side expiry for sensitive fields, and admin-only RLS plus sensitive Edge Functions require verified MFA. The old PWA/localStorage may still contain previously delivered data until site data is cleared. Other device-local features (tickets, profiles, applications and notifications) are not yet a confidential multi-user backend; do not put sensitive cross-user information there until separately migrated. Full security requires operational Auth/MFA settings, careful admin management, deployment verification and an independent review. Hiding the admin URL does not grant security.

## ⚠️ Important notes

- **Supabase Auth/RLS:** configure email/password Auth and allowed callback URLs, then run `supabase/schema.sql` before deployment. The app uses Supabase Auth tokens; RLS permits mirror access only to authenticated admins with trusted `app_metadata.role = 'admin'` (or `app_metadata.is_admin = true`). The schema removes legacy mirror policies and adds a database unique index for normalized Indian phone numbers.
- **Public frontend configuration:** the Supabase URL and publishable/anon key are public and may be set as Netlify build variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The app contains no service-role key. Existing localStorage accounts/passwords are not migrated; old account, demo subscription, simulated payment, and saved payment-method keys are cleared on startup.
- **Admin setup and deletion:** create the owner account `akhildivakara@gmail.com` in **Authentication → Users** and run `supabase/schema.sql`; the script promotes that account via the trusted `raw_app_meta_data.role` claim and sets its display name (no password is stored in SQL or the repo — set it privately in Supabase Auth), then sign out/in. The script also drops and recreates the dashboard views so an older view shape cannot block a re-run with SQLSTATE `42P16`. Deploy `supabase/functions/admin-delete-user` with `supabase functions deploy admin-delete-user`. The Edge Function checks the caller's Auth JWT/role and reads `SUPABASE_SERVICE_ROLE_KEY` only server-side before deleting an Auth account; never put that secret in Netlify's `VITE_*` variables or the repository.
- **Mirror behavior:** normal user sessions do not write admin-only mirror tables. Admin writes require a verified `aal2` administrator JWT and are rechecked by RLS. Subscription payment records and paid plan expiry are stored server-side in Supabase; the browser cannot write payment status or activate access.
- **Netlify:** `netlify.toml` specifies `npm run build` and `dist`. Connect the GitHub repo in Netlify for automatic deploys from `main`; a successful local build alone does not confirm a live Netlify deployment.
- **Payments:** follow the secure Razorpay/UPI setup below before accepting live payments. Never store Razorpay secrets in the frontend, Netlify `VITE_*` variables, or the repository.
- **PWA install:** after deploy, open the site in Chrome on Android → menu ⋮ → **Install app**. The app icon (`icon-512.png`) will appear on the home screen.
