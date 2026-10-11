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

## ⚠️ Important notes

- **Supabase Auth/RLS:** configure email/password Auth and allowed callback URLs, then run `supabase/schema.sql` before deployment. The app uses Supabase Auth tokens; RLS permits mirror access only to authenticated admins with trusted `app_metadata.role = 'admin'` (or `app_metadata.is_admin = true`). The schema removes legacy mirror policies and adds a database unique index for normalized Indian phone numbers.
- **Public frontend configuration:** the Supabase URL and publishable/anon key are public and may be set as Netlify build variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The app contains no service-role key. Existing localStorage accounts/passwords are not migrated; `mrc_users_v1` and the former local session are cleared on startup.
- **Admin setup and deletion:** create the owner account `akhildivakara@gmail.com` in **Authentication → Users** and run `supabase/schema.sql`; the script promotes that account via the trusted `raw_app_meta_data.role` claim and sets its display name (no password is stored in SQL or the repo — set it privately in Supabase Auth), then sign out/in. The script also drops and recreates the dashboard views so an older view shape cannot block a re-run with SQLSTATE `42P16`. Deploy `supabase/functions/admin-delete-user` with `supabase functions deploy admin-delete-user`. The Edge Function checks the caller's Auth JWT/role and reads `SUPABASE_SERVICE_ROLE_KEY` only server-side before deleting an Auth account; never put that secret in Netlify's `VITE_*` variables or the repository.
- **Mirror behavior:** normal user sessions do not write admin-only mirror tables. Admin writes use the current Supabase Auth bearer token and are rechecked by RLS. Most product data and simulated checkout are still local-first; saved payment methods remain local and do not sync.
- **Netlify:** `netlify.toml` specifies `npm run build` and `dist`. Connect the GitHub repo in Netlify for automatic deploys from `main`; a successful local build alone does not confirm a live Netlify deployment.
- **Payments:** the Razorpay/UPI checkout is simulated. Wire real Razorpay keys (admin → Payments → Add method) and their checkout SDK for production money.
- **PWA install:** after deploy, open the site in Chrome on Android → menu ⋮ → **Install app**. The app icon (`icon-512.png`) will appear on the home screen.
