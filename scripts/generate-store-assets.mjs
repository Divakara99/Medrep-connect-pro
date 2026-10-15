#!/usr/bin/env node
/**
 * Play Store graphics from src/assets/logo.svg (npm run store:assets).
 *
 *   store-listing/icon-512.png          512x512  Play store icon
 *   store-listing/feature-graphic.png   1024x500 Play feature graphic
 *   store-listing/screenshot-*.png      1080x1920 TEMPLATE frames
 *
 * ⚠ The screenshots are layout templates that mirror the real screens.
 * Google Play requires screenshots of the actual app: install the debug APK,
 * capture the four scenes listed in store-listing/README.md on a phone, and
 * overwrite these files before submitting. Do not submit the templates.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'store-listing')
mkdirSync(OUT, { recursive: true })

const source = readFileSync(resolve(ROOT, 'src/assets/logo.svg'), 'utf8')
const defs = source.match(/<defs>[\s\S]*?<\/defs>/)?.[0]
if (!defs) throw new Error('logo.svg <defs> not found')

function render(svg, width, height, name) {
  const png = Buffer.from(new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'sans-serif' },
  }).render().asPng())
  if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
    throw new Error(`${name}: rendered ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, expected ${width}x${height}`)
  }
  writeFileSync(resolve(OUT, name), png)
  console.log(`${name} ${width}x${height}`)
}

const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

// --- Feature graphic 1024x500 -------------------------------------------------
render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500">
  ${defs}
  <rect width="1024" height="500" fill="url(#mrc-tile)"/>
  <g transform="translate(56 90) scale(0.625)"><rect width="512" height="512" rx="112" fill="#ffffff" fill-opacity="0.14"/><use href="#mrc-mark"/></g>
  <text x="480" y="215" font-family="sans-serif" font-size="72" font-weight="800" fill="#ffffff">MedRep Pro</text>
  <text x="480" y="285" font-family="sans-serif" font-size="34" fill="#dbeafe">Pharma &amp; MR jobs across India</text>
  <text x="480" y="345" font-family="sans-serif" font-size="27" fill="#bfdbfe">Reveal a company free — subscribe for contacts</text>
</svg>`, 1024, 500, 'feature-graphic.png')

// --- Play icon: reuse the generated 512 icon ----------------------------------
copyFileSync(resolve(ROOT, 'public/icon-512.png'), resolve(OUT, 'icon-512.png'))
console.log('icon-512.png (copied from public/icon-512.png)')

// --- Screenshot templates 1080x1920 -------------------------------------------
const scenes = [
  {
    file: 'screenshot-1-home.png',
    headline: 'MR jobs, pinned first',
    lines: ['Medical Representative', 'Chennai · ₹2–4 LPA', 'ABM · Cardiology', 'Hyderabad · 2–5 yrs'],
    footer: 'Search + filters for every role',
  },
  {
    file: 'screenshot-2-unlock.png',
    headline: 'Reveal a company',
    lines: ['▶ Watch a short video', 'Company unlocked ✓', 'Yours to keep, no daily limit', 'Subscribe for contacts'],
    footer: 'One video per job, unlocked forever',
  },
  {
    file: 'screenshot-3-details.png',
    headline: 'Full job details, free',
    lines: ['City, HQ & division', 'Salary & experience', 'Point-wise description', 'Posted date on every job'],
    footer: 'Only contact details wait for a plan',
  },
  {
    file: 'screenshot-4-plans.png',
    headline: 'Plans for every hunt',
    lines: ['5 Days Trial', '15 Days Pro', '30 Days Standard', '1 Year Ultimate'],
    footer: 'Pay securely with Google Play',
  },
]

for (const scene of scenes) {
  const rows = scene.lines.map((line, i) => `
    <rect x="90" y="${760 + i * 190}" width="900" height="140" rx="28" fill="#ffffff"/>
    <text x="140" y="${845 + i * 190}" font-family="sans-serif" font-size="52" font-weight="700" fill="#0f172a">${esc(line)}</text>`).join('')
  render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
    ${defs}
    <rect width="1080" height="1920" fill="#f6f8fb"/>
    <rect width="1080" height="560" fill="url(#mrc-tile)"/>
    <g transform="translate(90 90) scale(0.42)"><rect width="512" height="512" rx="112" fill="#ffffff" fill-opacity="0.14"/><use href="#mrc-mark"/></g>
    <text x="330" y="205" font-family="sans-serif" font-size="60" font-weight="800" fill="#ffffff">MedRep Pro</text>
    <text x="90" y="440" font-family="sans-serif" font-size="68" font-weight="800" fill="#ffffff">${esc(scene.headline)}</text>
    ${rows}
    <text x="90" y="1760" font-family="sans-serif" font-size="44" fill="#475569">${esc(scene.footer)}</text>
  </svg>`, 1080, 1920, scene.file)
}
console.log('Done. Screenshots are TEMPLATES — replace with real captures (store-listing/README.md).')
