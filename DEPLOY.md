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

- **Supabase write mirror:** users/jobs/payments still live in each visitor's
  browser `localStorage`; selected new and updated records are asynchronously
  mirrored to the configured Supabase project. The app does not read remote data
  back or migrate existing localStorage records. The default project URL and
  public publishable/anon key are configured in `src/data/supabase.ts`; set
  `VITE_SUPABASE_URL` and/or `VITE_SUPABASE_ANON_KEY` in your host's build
  environment to override them. Run `supabase/schema.sql` in the Supabase SQL
  Editor before deployment. The admin dashboard cloud card reports mirror status.
- **Supabase security:** the provided schema grants `anon` and `authenticated`
  full access to these tables so browser upserts work. The anon key is public in
  the client bundle, so do not mirror private/production data with those policies;
  tighten RLS and authorization rules first. Local plaintext passwords and saved
  payment methods are excluded from the mirror.
- **Payments:** the Razorpay/UPI checkout is simulated. Wire real Razorpay keys
  (admin → Payments → Add method) and their checkout SDK for production money.
- **PWA install:** after deploy, open the site in Chrome on Android →
  menu ⋮ → **Install app**. The app icon (`icon-512.png`) will appear on the
  home screen.
