import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// package.json is the single source of truth for the release version. It is
// injected as a compile-time constant so the UI (src/data/version.ts) always
// shows the shipped version without any hand-maintained duplicate.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}
// Every build of 1.0.2 looks identical in the UI, so "did you install the new
// one?" has cost us several rounds: the version badge cannot tell two APKs
// apart. The commit and build time go into the bundle, and the app shows them,
// so a screenshot answers the question on its own.
const buildStamp = `${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)} · ${new Date()
  .toISOString()
  .slice(0, 16)
  .replace('T', ' ')}Z`

export default defineConfig({
  // Relative base: the built app works from ANY host or sub-path
  // (Netlify/Vercel root, GitHub Pages project site, any folder on a server).
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_STAMP__: JSON.stringify(buildStamp),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
