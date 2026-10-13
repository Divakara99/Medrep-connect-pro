# 🚀 Deploy MedRep Connect Pro — Step-by-Step Guide

The app builds to a pure static bundle (`dist/`) — HTML, JavaScript, CSS, and
PWA files. It runs on any static host. The build uses relative paths
(`base: './'`), so it works at a domain root or in a sub-folder.

---

## Quick start — step by step

Follow these steps in order. Each command is in a box with a **copy** button (top right of the box when you hover over it). You need Node.js 22, Git, your Supabase project, your Netlify site, and (for payments) a Razorpay account.

### Step 1 — Get the code and check it (terminal)

```bash
git clone https://github.com/Divakara99/Medrep-connect-pro.git
cd Medrep-connect-pro
git checkout main
npm ci
npm run lint
npm run build
npm test
```

What each line does:

| Command | Meaning |
| --- | --- |
| `git clone …` | Downloads the project into a folder named `Medrep-connect-pro`. |
| `cd Medrep-connect-pro` | Moves into that folder. All later commands run from here. |
| `git checkout main` | Uses the release branch that Netlify publishes. |
| `npm ci` | Installs the exact dependency versions in `package-lock.json`. |
| `npm run lint` | Checks the code for mistakes. It should report `0 errors`. |
| `npm run build` | Type-checks and builds the website into `dist/`. It should end with `built in`. |
| `npm test` | Runs the database and rule checks. Each line should end with `passed` or `agree on all 12 cases`. |

If any step fails, stop and fix that step before continuing.

### Step 2 — Create the database tables (SQL Editor, one click to copy)

Run the migrations **in this order**, in the Supabase project that matches `VITE_SUPABASE_URL`. Each file is safe to run again.

```bash
npm run db:list          # shows the 11 files in the correct order
npm run db:copy -- 1     # copies supabase/schema.sql to your clipboard
```

Then in the Supabase dashboard:

1. Open **SQL Editor → New query**.
2. Click in the editor and press **Ctrl+V** (Windows/Linux) or **⌘V** (Mac) to paste.
3. Press **Run**. Wait for "Success", then go back to the terminal.
4. Repeat for `npm run db:copy -- 2` through `npm run db:copy -- 11`.

**Prefer one paste?** Run `npm run db:copy -- all`, paste once, and press **Run**. If an error appears, fix it and run the same paste again: the files are safe to re-run.

If the terminal says *"No clipboard tool was found"*, it prints the SQL instead. Select the text between `-----BEGIN SQL-----` and `-----END SQL-----` and copy it by hand.

### Step 3 — Schedule the resume purge (SQL Editor)

Resumes are deleted 30 days after upload. The schedule is set up in [section 4](#4-schedule-the-resume-retention-purge) below. Run it once after Step 2.

### Step 4 — Deploy the payment and admin functions (terminal, Supabase CLI)

These functions run on Supabase, not on Netlify. Netlify does not deploy them.

```bash
npx supabase login
npx supabase functions deploy create-razorpay-order --project-ref <your-project-ref>
npx supabase functions deploy verify-razorpay-payment --project-ref <your-project-ref>
npx supabase functions deploy razorpay-webhook --project-ref <your-project-ref>
npx supabase functions deploy create-upi-intent --project-ref <your-project-ref>
npx supabase functions deploy admin-delete-user --project-ref <your-project-ref>
npx supabase functions deploy admin-manage-employees --project-ref <your-project-ref>
npx supabase functions deploy send-push --project-ref <your-project-ref> --use-api
```

- `npx supabase login` opens a browser so you can sign in to Supabase. It does not ask for a password in the terminal.
- Replace `<your-project-ref>` with the ID in your Supabase URL: `https://<your-project-ref>.supabase.co`.
- The `create-upi-intent` line deploys the disabled version, so no new manual UPI payment can be created.
- The `admin-manage-employees` line deploys the function that creates, resets and deletes vacancy team logins. It needs the migration in Step 2 (`vacancy_team.sql`) first.
- **Re-deploy `admin-delete-user`, `review-manual-upi-payment` and `admin-manage-employees` from this release even if you deployed them before:** each of them now reads the sign-in-code switch, so an administrator who is allowed into the console is also allowed to use the buttons there. Without the re-deploy the functions keep refusing a password-only session after the code is switched OFF.
- The `send-push` line deploys the phone-notification sender. It needs Step 2 (`push_subscriptions.sql`) and the three VAPID secrets from Step 5a first, otherwise users can switch notifications on but nothing can be delivered.

### Step 5 — Add the secret keys (Supabase dashboard, never in chat or Git)

In **Supabase → Edge Functions → Secrets**, add these three names and paste the values from your Razorpay dashboard:

| Secret name | Where to get it |
| --- | --- |
| `RAZORPAY_KEY_ID` | Razorpay → Settings → API Keys (`rzp_test_…` for testing) |
| `RAZORPAY_KEY_SECRET` | The secret shown with that key. Store it only here. |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you set on the Razorpay webhook (Step 7) |

Use a matching pair from the same mode. Test with `rzp_test_` keys first.

### Step 5a — Add the notification (VAPID) keys

Phone notifications need one key pair that signs every notification this project
sends. Generate it in this repository — nothing leaves the machine:

```bash
npm run vapid:keys -- <your-project-ref>
```

The command prints the three `npx supabase secrets set` lines to paste, with the
random keys already filled in. It self-checks the pair before printing, so a
copy-paste mistake in a key shows up as a failure, not as silent notifications.

| Secret name | What it is |
| --- | --- |
| `VAPID_PUBLIC_KEY` | The public half. Browsers receive it from the `send-push` function — it is not a secret, but it must match the private key. |
| `VAPID_PRIVATE_KEY` | **Secret.** Signs every notification. Never paste it into chat, code or Git. |
| `VAPID_SUBJECT` | Your contact, as `mailto:you@example.com` or an `https://` page. Push services use it to reach you if a delivery is abusive. |

Run the generated `secrets set` command, then deploy `send-push` (Step 4). To
start over, run `npm run vapid:keys` again and set all three secrets with the new
pair — every device re-subscribes automatically the next time its owner opens the
app, so old devices simply stop ringing until then.

### Step 6 — Publish the website (Netlify)

1. Open the Netlify site for the project, then **Site configuration → Environment variables**.
2. If your Supabase project is not the built-in default, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the public anon key, not the secret key). See [`.env.example`](.env.example).
3. Make sure the production branch is `main`, then click **Deploys → Trigger deploy**.

### Step 7 — Connect Razorpay webhooks

In the Razorpay dashboard, add the webhook URL `https://<your-project-ref>.supabase.co/functions/v1/razorpay-webhook`, subscribe to `payment.captured`, and set the same secret as `RAZORPAY_WEBHOOK_SECRET`.

### Step 8 — Check it works

- [ ] Sign in, open **Plans**, pick a plan, and check the amount shown matches the catalogue price.
- [ ] Open **Account**: your profile, your resume card and **My applications** load.
- [ ] Upload a small PDF on **Account → Profile details**, then download it again.
- [ ] Open the **Terms** link on **Plans** (blue "Click here") and check the full text opens.
- [ ] Open the admin panel, go to **Vacancy team**, create a test login, sign in at `/?portal=vacancy` with it, post a vacancy and delete it with a reason. The deletion then shows in the activity list.
- [ ] On a phone, open the app in Chrome → 🔔 **Notifications** → **Turn on notifications**, then **Send a test**. The test must appear within a few seconds, with sound. If it says the platform is not ready, Step 5a or the `send-push` deploy is missing.
- [ ] In the admin panel, open **📣 Announcements**, send one, and check a second account hears it and sees it under 🔔 (with sound while the app is open, and as a phone notification when it is closed).
- [ ] In the admin panel, open **🔐 Security** and confirm the sign-in code shows **ON**. Only switch it off if an authenticator is lost — the panel then opens with email and password only until it is switched back on, and every change is listed in the audit trail below the switch.
- [ ] In **AI Help**, type "refund", pick the reason and payment, describe the problem, and check the verdict. Nothing is sent until you tap the yes button. Then open **Account → My requests** to see the new request.

For the detailed explanations, troubleshooting and the migration table, read the sections below.

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

## Required before this release goes live

**Coordinate these changes in a short maintenance window.** The frontend and the
database must move together: the new app reads the server billing catalog, the
private resume bucket and the server-side application records, and the
administrator gate is a verified authenticator again.

### 0. If the frontend ships before the migrations

The frontend degrades instead of failing, but features stay limited until the
SQL is applied:

| Area | Behaviour before the migration |
| --- | --- |
| Jobs | `list_visible_jobs()` still works; free users see no description and HQ/division show "—" until the new `secure_jobs.sql` is applied. |
| Plans | The catalog read fails, so the screen shows the standard seven plans and prices from its built-in fallback. Checkout still works against the previously deployed `create-razorpay-order`. |
| Resume (Account → Profile details) | Upload is disabled with a "storage is being enabled" notice. |
| Apply | The mail/WhatsApp composer still opens; the toast says the application could not be added to history yet. |
| **Admin panel** | **Blocked.** The portal requires an `aal2` session, so an administrator must enable TOTP in Supabase Auth (step 1) before the panel opens. This is the intended fix — production currently has no second factor at all. |

### 1. Restore administrator TOTP MFA (replaces the fixed access code)

The previous release shipped a fixed 4-digit access code (`9676`) inside the
public browser bundle and removed the `aal2` requirement from
`is_app_admin()`. Both are reverted:

1. In Supabase **Authentication → Attack Protection / MFA**, enable TOTP and
   allow `aal2` sessions.
2. Run [`supabase/admin_mfa.sql`](supabase/admin_mfa.sql) (also re-run
   [`supabase/admin_access.sql`](supabase/admin_access.sql), which no longer
   relaxes the gate). `is_app_admin()` again requires the trusted
   `app_metadata.role = 'admin'` claim **and** `auth.jwt().aal = 'aal2'`.
3. Deploy the updated `admin-delete-user` and `review-manual-upi-payment`
   Edge Functions; both refuse a JWT without `aal2`:
   ```bash
   npx supabase login
   npx supabase functions deploy admin-delete-user --project-ref <production-project-ref>
   npx supabase functions deploy review-manual-upi-payment --project-ref <production-project-ref>
   ```
4. After the new frontend is live, sign in to `/?portal=admin` with the admin
   password. The authenticator screen enrols a TOTP factor on first use (scan
   the QR with Google Authenticator / Authy) and asks for the six-digit code on
   every later session. Keep the recovery route in mind: a project owner removes
   the factor in **Authentication → Users** if the device is lost.

Until step 2 is applied to production, an already-live project still runs the
relaxed role-only gate — apply the SQL before or with the frontend deploy.

### 2. Apply the database migrations, in this order

Run each file in the SQL Editor of the SAME project used by
`VITE_SUPABASE_URL`. All of them are safe to re-run.

| Order | File | What it does |
| --- | --- | --- |
| 1 | `supabase/schema.sql` | Auth-backed accounts, admin-only mirror RLS (unchanged). |
| 2 | `supabase/payments.sql` | `subscription_payments` ledger and the verified activation functions (unchanged). |
| 3 | `supabase/secure_jobs.sql` | Job projection: city, HQ, division, salary, experience and the **description** are public to signed-in users and never blurred; company name, manager name, manager email, primary contact and the optional alternate number stay subscriber-only. Adds a trigger that rejects phone numbers and email addresses in the public description. |
| 4 | `supabase/user_notifications.sql` | Durable broadcast job notifications (unchanged). |
| 5 | `supabase/admin_access.sql` | `manual_grant` payment method + audited `grant_manual_access`. No longer relaxes `is_app_admin()`. |
| 6 | `supabase/admin_mfa.sql` | Reinstates the `aal2` requirement and adds `current_admin_session()` for diagnostics. **Re-run the current version:** it adds the sign-in-code switch (`app_settings`, `admin_mfa_required()`, `set_admin_mfa_required()`, `admin_security_state()`) and the `app_settings_audit` trail the admin panel's 🔐 Security tab reads. The code stays ON until an administrator switches it off. |
| 7 | `supabase/billing_plans.sql` | **New.** Server-side plan catalog (`public.billing_plans`) seeded with the seven existing plans; `save_billing_plan()` is admin+MFA only and refuses to retire the last purchasable plan. |
| 8 | `supabase/resumes.sql` | **New.** Private `resumes` storage bucket, owner-only `resume_documents`, forced 30-day retention and `delete_expired_resumes()`. |
| 9 | `supabase/applications.sql` | **New.** `record_application()` / `list_my_applications()` so a user's application history is stored server-side with the verified identity. |
| 10 | `supabase/support_requests.sql` | **New.** `public.support_requests` for refund and support requests. `create_support_request()` re-checks refund eligibility on the server and stores the account snapshot. Users read only their own requests; `admin_update_support_request()` is admin + MFA only. |
| 11 | `supabase/vacancy_team.sql` | **New.** Vacancy team logins (`vacancy_editor` role) that can only post, list and delete vacancies, through `employee_post_vacancy()`, `employee_list_vacancies()` and `employee_delete_vacancy()`. Adds `vacancy_audit`, which records every vacancy added or deleted, by admin or team, with the delete reason. Only an administrator with MFA can read it. Earlier vacancies are backfilled once. |
| 12 | `supabase/push_subscriptions.sql` | **New.** One row per notification device (`push_subscriptions`) with `enabled`, identity stamped from the verified JWT; `save_push_subscription()` / `delete_push_subscription()` let a user manage only their own devices, `push_subscription_stats()` is admin-only, and `push_delivery_log` records what each send reached. |

**Vacancy team logins (new).** The administrator creates one login ID and password for the employee in **Admin → Vacancy team**. Only one employee login exists at a time, and the database enforces this. To change employee, delete the current login first, then create the new one. Team members sign in at `/?portal=vacancy` and see one page: post a vacancy, and delete one with a required reason. The admin sees how many vacancies were added and deleted, who did it, and every deletion reason. The team cannot see users, payments, the audit log or other team logins. The login ID is the employee's email address, because the sign-in system requires one. Passwords must be 12 to 72 characters. New team accounts are created already confirmed, so no confirmation email is sent. Team logins use a password only (no authenticator code), so choose strong passwords and remove a login as soon as someone leaves.

**Support requests replace device-only tickets.** Earlier builds kept tickets only in each browser (`mrc_tickets_v1`), so the administrator never saw them. The app removes that browser copy on first load. Requests raised from now on are stored in `support_requests`, and users track them under Account → My requests.

**Existing subscriptions and orders are preserved.** `billing_plans.sql` seeds
with `ON CONFLICT DO NOTHING`, `subscription_payments` keeps its own
`amount_paise` / `plan_days` snapshot per order, and activation reads that
snapshot — so a later price change never rewrites history or an active expiry.

### 3. Pre-flight check for public descriptions

The new description guard rejects a vacancy save whose description contains a
phone number or email address. Find affected rows before the admin edits them:

```sql
select id, data ->> 'title' as title
from public.vacancies
where coalesce(data ->> 'deleted', 'false') <> 'true'
  and (
    coalesce(data ->> 'description', '') ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    or coalesce(data ->> 'description', '') ~ '\+?[0-9][0-9 ()\-\.]{7,}[0-9]'
  );
```

Move any contact details into the Manager / Contact / Manager email fields.

### 4. Schedule the resume retention purge

Resumes expire 30 days after upload. Enable `pg_cron` in **Database →
Extensions**, then schedule the purge (it deletes the metadata row and the
stored object together):

```sql
select cron.schedule(
  'purge-expired-resumes',
  '17 19 * * *',
  $$select public.delete_expired_resumes()$$
);
```

Without the schedule, expired resumes are simply never offered to the user
again, but the objects stay in the bucket.

### 5. Verify, then publish the frontend

```sql
select to_regprocedure('public.list_visible_jobs()') as jobs_rpc,
       has_function_privilege('anon', 'public.list_visible_jobs()', 'EXECUTE') as anon_can_run,
       (select count(*) from public.billing_plans where active) as purchasable_plans,
       (select public from storage.buckets where id = 'resumes') as resumes_public;
```

`jobs_rpc` must be non-null, `anon_can_run` must be `false`,
`purchasable_plans` must be `7` (or your chosen set), and `resumes_public`
must be `false`.

Then deploy `create-razorpay-order` again — it now prices orders from
`public.billing_plans` instead of a hard-coded list:

```bash
npx supabase functions deploy create-razorpay-order --project-ref <production-project-ref>
```

Merge the PR, wait for the host to publish `main`, and confirm with two
accounts:

* a **free** user sees the city, HQ, division, salary, experience and
  description, and their `list_visible_jobs` response contains no `company`,
  `manager`, `managerEmail`, `contact` or `managerAltPhone` key;
* the same user can pick **any** plan and the Razorpay modal amount matches the
  catalog price;
* an **admin** without a verified authenticator cannot open the admin panel,
  and cannot save a price change from the Plans tab;
* uploading a resume keeps the user on the Account screen and the file is not
  visible in browser storage.

On user devices with older versions, clear site data/old PWA cache once and
sign in again. The app purges its own legacy keys on start-up
(`mrc_plans_v1`, `mrc_alt_payment_v1`, `mrc_resume_v1*`,
`mrc_verified_payment_cache_v1`), so previously delivered browser data is
removed rather than trusted.

Client-side 12-character password checks are a convenience, not a substitute
for your Supabase Auth policy. Account recovery must be performed by a trusted
Supabase project owner using the Auth Dashboard/admin tools. A hidden entry
route is not authentication.

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

**Security scope:** Payment activation and expiry are server-verified and priced from the server catalog; the job RPC enforces server-side expiry for confidential fields; admin-only RLS and the sensitive Edge Functions require the trusted admin role claim **plus a verified authenticator (`aal2`)**; resumes live in a private bucket readable only by their owner. The old PWA/localStorage may still contain previously delivered data until site data is cleared. Profiles and tickets are still device-local and must not hold data requiring cross-device confidentiality until separately migrated. Full security requires operational Auth settings, careful admin management, deployment verification and an independent review. Hiding the admin URL does not grant security.

## Exact deployment steps for `create-razorpay-order`

Run these after this change is merged (or from this branch). Merging the PR or
Netlify publishing the website **does not** deploy Edge Functions — the
function must be deployed with the Supabase CLI.

1. **Prerequisites (once per project):** in the Supabase SQL Editor of the
   project behind `VITE_SUPABASE_URL`, apply `supabase/schema.sql` →
   `supabase/payments.sql` → `supabase/secure_jobs.sql` →
   `supabase/user_notifications.sql` → `supabase/admin_access.sql`, in that
   order. The payments table and both payment RPCs must already exist.
2. **Enter the replacement Razorpay keys privately** (never paste them into
   chat, code, git or Netlify): Supabase Dashboard → Edge Functions → Secrets
   → add/update both secrets as an exact matching pair from the same merchant
   account and mode:
   - `RAZORPAY_KEY_ID` (e.g. `rzp_test_…` or `rzp_live_…`)
   - `RAZORPAY_KEY_SECRET`
   Also keep `RAZORPAY_WEBHOOK_SECRET` set for captured-payment webhooks. The
   code has no key-ID fallback: if either value is missing or the pair does
   not match, order creation returns 503/502. After any leak, revoke the old
   pair in the Razorpay Dashboard before creating the replacement.
3. **Deploy the function** from the repository root (bundles
   `supabase/functions/_shared/razorpay.ts` with it):
   ```bash
   npx supabase login
   npx supabase functions deploy create-razorpay-order --project-ref <production-project-ref>
   ```
   Use the project ref shown in the Supabase dashboard; authenticate privately
   via the CLI. Do not pass payment credentials on the command line.
4. **Deploy the companion payment functions in the same window** so the whole
   checkout path matches this code:
   ```bash
   npx supabase functions deploy verify-razorpay-payment --project-ref <production-project-ref>
   npx supabase functions deploy razorpay-webhook --project-ref <production-project-ref>
   ```
   (Legacy only, if you still reconcile old manual UPI rows: also deploy
   `submit-upi-utr` and `review-manual-upi-payment`. Redeploy `create-upi-intent`
   once as a disabled endpoint so an old build can no longer expose a VPA.)
5. **Verify:** in Edge Functions → Logs, open `create-razorpay-order`. A failed
   attempt logs only `{ httpStatus, errorCode }` (or `unavailable`) — never
   credentials or response bodies. Then in the app: Plans → the locked 15-day
   plan → Pay with Razorpay. In Razorpay test mode, exercise success, failure,
   duplicate callback and renewal before switching secrets to the live pair.
   Do not retry live payments until the exposed pair has been revoked.

## ⚠️ Important notes

- **Supabase Auth/RLS:** configure email/password Auth and allowed callback URLs, then run `supabase/schema.sql` before deployment. The app uses Supabase Auth tokens; RLS permits mirror access only to authenticated admins with trusted `app_metadata.role = 'admin'` (or `app_metadata.is_admin = true`). The schema removes legacy mirror policies and adds a database unique index for normalized Indian phone numbers.
- **Public frontend configuration:** the Supabase URL and publishable/anon key are public and may be set as Netlify build variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The app contains no service-role key. Existing localStorage accounts/passwords are not migrated; old account, demo subscription, simulated payment, and saved payment-method keys are cleared on startup.
- **Admin setup and deletion:** create the owner account `akhildivakara@gmail.com` in **Authentication → Users** and run `supabase/schema.sql`; the script promotes that account via the trusted `raw_app_meta_data.role` claim and sets its display name (no password is stored in SQL or the repo — set it privately in Supabase Auth), then sign out/in. The script also drops and recreates the dashboard views so an older view shape cannot block a re-run with SQLSTATE `42P16`. Deploy `supabase/functions/admin-delete-user` with `supabase functions deploy admin-delete-user`. The Edge Function checks the caller's Auth JWT/role and reads `SUPABASE_SERVICE_ROLE_KEY` only server-side before deleting an Auth account; never put that secret in Netlify's `VITE_*` variables or the repository.
- **Mirror behavior:** normal user sessions do not write admin-only mirror tables. Admin writes require the trusted `app_metadata` admin role claim and are rechecked by RLS. Subscription payment records and paid plan expiry are stored server-side in Supabase; the browser cannot write payment status or activate access. Broadcast notifications (new job posts and job updates) are read by users through the shaped `list_visible_notifications()` RPC from `supabase/user_notifications.sql`.
- **Netlify:** `netlify.toml` specifies `npm run build` and `dist`. Connect the GitHub repo in Netlify for automatic deploys from `main`; a successful local build alone does not confirm a live Netlify deployment.
- **Payments:** follow the secure Razorpay/UPI setup below before accepting live payments. Never store Razorpay secrets in the frontend, Netlify `VITE_*` variables, or the repository.
- **PWA install:** after deploy, open the site in Chrome on Android → menu ⋮ → **Install app**. The app icon (`icon-512.png`) will appear on the home screen.
