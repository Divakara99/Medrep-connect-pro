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

**Security limitation:** Payment activation and expiry are enforced by server-side SQL/RLS and verified Edge Functions. Job listings and their contact details, however, are currently distributed via the browser's local-first data store; UI blur is not access control. Do not put confidential/premium-only job data in this frontend until jobs are moved to a backend with server-side entitlement checks and RLS. Browser headers and visual locks cannot replace that migration. A full security review should include the Supabase policies, Auth settings, third-party checkout, and deployment configuration.

## ⚠️ Important notes

- **Supabase Auth/RLS:** configure email/password Auth and allowed callback URLs, then run `supabase/schema.sql` before deployment. The app uses Supabase Auth tokens; RLS permits mirror access only to authenticated admins with trusted `app_metadata.role = 'admin'` (or `app_metadata.is_admin = true`). The schema removes legacy mirror policies and adds a database unique index for normalized Indian phone numbers.
- **Public frontend configuration:** the Supabase URL and publishable/anon key are public and may be set as Netlify build variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The app contains no service-role key. Existing localStorage accounts/passwords are not migrated; old account, demo subscription, simulated payment, and saved payment-method keys are cleared on startup.
- **Admin setup and deletion:** create the owner account `akhildivakara@gmail.com` in **Authentication → Users** and run `supabase/schema.sql`; the script promotes that account via the trusted `raw_app_meta_data.role` claim and sets its display name (no password is stored in SQL or the repo — set it privately in Supabase Auth), then sign out/in. The script also drops and recreates the dashboard views so an older view shape cannot block a re-run with SQLSTATE `42P16`. Deploy `supabase/functions/admin-delete-user` with `supabase functions deploy admin-delete-user`. The Edge Function checks the caller's Auth JWT/role and reads `SUPABASE_SERVICE_ROLE_KEY` only server-side before deleting an Auth account; never put that secret in Netlify's `VITE_*` variables or the repository.
- **Mirror behavior:** normal user sessions do not write admin-only mirror tables. Admin writes use the current Supabase Auth bearer token and are rechecked by RLS. Subscription payment records and paid plan expiry are stored server-side in Supabase; the browser cannot write payment status or activate access.
- **Netlify:** `netlify.toml` specifies `npm run build` and `dist`. Connect the GitHub repo in Netlify for automatic deploys from `main`; a successful local build alone does not confirm a live Netlify deployment.
- **Payments:** follow the secure Razorpay/UPI setup below before accepting live payments. Never store Razorpay secrets in the frontend, Netlify `VITE_*` variables, or the repository.
- **PWA install:** after deploy, open the site in Chrome on Android → menu ⋮ → **Install app**. The app icon (`icon-512.png`) will appear on the home screen.
