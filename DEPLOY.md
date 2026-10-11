# 🚀 Deploy MedRep Connect Pro — Step-by-Step Guide

The app builds to a pure static bundle (`dist/`) — HTML + JS + CSS + PWA files.
It runs on **any** static host. The build uses relative paths (`base: './'`),
so it works at a domain root OR in a sub-folder.

---

## Option A — GitHub Pages (free, recommended)

A ready workflow is included: `.github/workflows/deploy.yml`.
It builds and publishes the site **automatically on every push to `main`**.

### One-time setup (2 minutes)

1. Push this repository to GitHub (`Divakara99/Medrep-connect-pro`).
2. On GitHub: **Settings → Pages → Build and deployment → Source: “GitHub Actions”**.
3. Push anything to `main` (or run the workflow manually:
   **Actions tab → “Deploy to GitHub Pages” → Run workflow**).
4. After ~1 minute your app is live at:
   **https://divakara99.github.io/Medrep-connect-pro/**

The same page is a full PWA — users can tap **Install app** in Chrome and it runs
like a native installed app on Android/desktop.

### Custom domain (optional)

**Settings → Pages → Custom domain** → enter e.g. `medrepconnect.in`,
then point your DNS (CNAME record) to `divakara99.github.io`. HTTPS is automatic.

---

## Option B — Netlify (free, drag & drop)

1. Run `npm run build` locally (or let Netlify build it).
2. Go to <https://app.netlify.com> → **Add new site → Deploy manually**.
3. **Drag the `dist` folder** into the drop zone. Live in seconds.
4. (Better long-term) **Import from GitHub** and set:
   - Build command: `npm run build`
   - Publish directory: `dist`
   Then every push to `main` auto-deploys.

---

## Option C — Vercel (free)

1. <https://vercel.com> → **Add New → Project** → import the GitHub repo.
2. Vercel auto-detects Vite — just click **Deploy**.
3. Every push to `main` auto-deploys. Free `*.vercel.app` domain included.

---

## Option D — Any web server / shared hosting

1. `npm run build`
2. Upload the entire `dist/` folder to `public_html` (cPanel) or your server.
3. That's it — no server code needed.

---

## Local production preview (test before deploying)

```bash
npm run build
npm run preview      # serves the exact production build
```

---

## ⚠️ Important notes

- **Supabase Auth/RLS:** configure email/password Auth and allowed callback URLs, then run `supabase/schema.sql` before deployment. The app uses Supabase Auth tokens; RLS permits mirror access only to authenticated admins with trusted `app_metadata.role = 'admin'` (or `app_metadata.is_admin = true`). The schema removes legacy mirror policies and adds a database unique index for normalized Indian phone numbers.
- **Public frontend configuration:** the Supabase URL and publishable/anon key are public and may be set as Netlify/GitHub build variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The app contains no service-role key. Existing localStorage accounts/passwords are not migrated; `mrc_users_v1` and the former local session are cleared on startup.
- **Admin setup and deletion:** create the owner account `akhildivakara@gmail.com` in **Authentication → Users** and run `supabase/schema.sql`; the script promotes that account via the trusted `raw_app_meta_data.role` claim and sets its display name (no password is stored in SQL or the repo — set it privately in Supabase Auth), then sign out/in. The script also drops and recreates the dashboard views so an older view shape cannot block a re-run with SQLSTATE `42P16`. Deploy `supabase/functions/admin-delete-user` with `supabase functions deploy admin-delete-user`. The Edge Function checks the caller's Auth JWT/role and reads `SUPABASE_SERVICE_ROLE_KEY` only server-side before deleting an Auth account; never put that secret in Netlify's `VITE_*` variables or the repository.
- **Mirror behavior:** normal user sessions do not write admin-only mirror tables. Admin writes use the current Supabase Auth bearer token and are rechecked by RLS. Most product data and simulated checkout are still local-first; saved payment methods remain local and do not sync.
- **Netlify:** `netlify.toml` specifies `npm run build` and `dist`. Connect the GitHub repo in Netlify for automatic deploys from `main`; a successful local build alone does not confirm a live Netlify deployment.
- **Payments:** the Razorpay/UPI checkout is simulated. Wire real Razorpay keys
  (admin → Payments → Add method) and their checkout SDK for production money.
- **PWA install:** after deploy, open the site in Chrome on Android →
  menu ⋮ → **Install app**. The app icon (`icon-512.png`) will appear on the
  home screen.
