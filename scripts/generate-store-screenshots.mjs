#!/usr/bin/env node
/**
 * The four Play Store phone screenshots (npm run store:screenshots:render).
 *
 * These are 1080x1920 renders of the app's own screens — same header, same
 * cards, same wording and prices as the running build — drawn from the design
 * tokens in src/index.css. They are not OS captures: this build machine has no
 * browser and no route to Supabase, so the four screens cannot be photographed
 * here. Real captures always beat these; replace the files any time with
 * SCREENSHOTS.md.
 *
 * Every number on the Plans screen comes from the live catalog (billing_plans:
 * p5 Rs 19 / 1 day … p365 Rs 1799 / 1 year), so the listing can never advertise
 * a price Google Play does not charge.
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'store-listing')
const W = 1080
const H = 1920
const FONT = 'DejaVu Sans'

const C = {
  brand: '#1b4efb',
  brandDark: '#143de0',
  brandSoft: '#eef5ff',
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  line: '#e2e8f0',
  page: '#f8fafc',
  white: '#ffffff',
  amber: '#b45309',
  amberBg: '#fffbeb',
  amberLine: '#fcd34d',
  green: '#047857',
  greenBg: '#ecfdf5',
  greenLine: '#6ee7b7',
  slateChip: '#eef2f7',
}

// --- opaque PNG writer -------------------------------------------------------
// Play rejects screenshots with an alpha channel, and resvg always emits RGBA.
// Re-encoding the same pixels as 8-bit RGB keeps the image identical and drops
// the alpha channel, without pulling in an image library.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/** RGBA pixels -> opaque RGB PNG, same pixels. */
function opaquePng(width, height, rgba) {
  const stride = 1 + width * 3
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const src = y * width * 4
    const dst = y * stride
    raw[dst] = 0
    for (let x = 0; x < width; x += 1) {
      raw[dst + 1 + x * 3] = rgba[src + x * 4]
      raw[dst + 2 + x * 3] = rgba[src + x * 4 + 1]
      raw[dst + 3 + x * 3] = rgba[src + x * 4 + 2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type 2 = truecolour, no alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const esc = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const text = (x, y, value, { size = 28, weight = 400, fill = C.ink, anchor = 'start', spacing = 0, opacity = 1 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}"` +
  ` text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ''}${opacity !== 1 ? ` opacity="${opacity}"` : ''}>${esc(value)}</text>`

const rect = (x, y, w, h, { r = 0, fill = C.white, stroke = null, sw = 2, opacity = 1 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"` +
  `${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}${opacity !== 1 ? ` opacity="${opacity}"` : ''}/>`

const circle = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`

/**
 * Rough rendered width of a string. DejaVu Sans Bold averages ~0.62 em for this
 * mix of upper/lower case, which is enough to keep a badge off the end of a
 * title and inside a card.
 */
const measure = (value, size, weight = 700) => Math.round(value.length * size * (weight >= 700 ? 0.62 : 0.57))

/** A pill with centred label, sized to an estimate of the text width. */
function pill(x, y, label, { size = 26, fill = C.slateChip, color = C.body, padX = 22, h = 54, weight = 600, stroke = null } = {}) {
  const w = measure(label, size, weight) + padX * 2
  return {
    w,
    svg: rect(x, y, w, h, { r: h / 2, fill, stroke })
      + text(x + w / 2, y + h / 2 + size * 0.36, label, { size, weight, fill: color, anchor: 'middle' }),
  }
}

/** Phone status bar: time on the left, signal / wifi / battery on the right. */
function statusBar() {
  const y = 62
  return [
    text(48, y, '8:38', { size: 30, weight: 700 }),
    // signal bars
    ...[0, 1, 2, 3].map((i) => rect(806 + i * 15, y - 12 - i * 7, 10, 12 + i * 7, { r: 3, fill: C.ink })),
    text(878, y, '4G', { size: 26, weight: 700 }),
    // wifi arcs
    `<path d="M946 ${y - 16} a28 28 0 0 1 40 0" fill="none" stroke="${C.ink}" stroke-width="6" stroke-linecap="round"/>`,
    `<path d="M955 ${y - 5} a16 16 0 0 1 22 0" fill="none" stroke="${C.ink}" stroke-width="6" stroke-linecap="round"/>`,
    circle(966, y, 5, C.ink),
    // battery
    rect(1000, y - 24, 44, 26, { r: 7, fill: 'none', stroke: C.ink, sw: 4 }),
    rect(1004, y - 20, 24, 18, { r: 3, fill: C.ink }),
    rect(1046, y - 16, 5, 10, { r: 2, fill: C.ink }),
    text(960, y, '32', { size: 22, weight: 700, fill: C.ink }),
  ].join('')
}

/** App header: logo, wordmark, centred page name, menu button. */
function appHeader() {
  const top = 100
  const cx = 46
  return [
    rect(0, top, W, 132, { fill: C.white }),
    // logo: blue tile with a white card + plus
    rect(cx, top + 30, 72, 72, { r: 20, fill: C.brand }),
    rect(cx + 16, top + 48, 40, 34, { r: 9, fill: C.white }),
    rect(cx + 31, top + 54, 10, 22, { r: 3, fill: C.brand }),
    rect(cx + 25, top + 60, 22, 10, { r: 3, fill: C.brand }),
    text(cx + 92, top + 62, 'MedRep Connect Pro', { size: 33, weight: 700 }),
    text(cx + 93, top + 92, 'PHARMA & JOBS HUB', { size: 17, weight: 600, fill: C.muted, spacing: 2.4 }),
    rect(W - 118, top + 28, 72, 72, { r: 22, fill: C.white, stroke: C.line }),
    ...[0, 1, 2].map((i) => rect(W - 100, top + 52 + i * 14, 36, 5, { r: 2.5, fill: '#475569' })),
    rect(0, top + 130, W, 2, { fill: C.line }),
  ].join('')
}

/** Blue hero card: network label, founder credit, greeting, counts. */
function hero() {
  const x = 32
  const y = 250
  const w = W - 64
  const h = 392
  return [
    `<defs><linearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b4efb"/><stop offset="1" stop-color="#3f6bff"/>
    </linearGradient></defs>`,
    rect(x, y, w, h, { r: 28, fill: 'url(#hero)' }),
    text(x + 34, y + 56, "INDIA'S 1ST PHARMA-JOB NETWORK", { size: 20, weight: 700, fill: '#c7d7ff', spacing: 1.6 }),
    rect(x + 34, y + 92, 470, 46, { r: 23, fill: '#ffffff', opacity: 0.16 }),
    text(x + 56, y + 124, 'APP CREATED BY M. DIVAKAR REDDY', { size: 20, weight: 700, fill: '#ffffff' }),
    text(x + 34, y + 196, 'Hello, Divakar', { size: 52, weight: 700, fill: '#ffffff' }),
    text(x + 34, y + 238, 'Find your next MR / ABM role — MR vacancies pinned first,', { size: 24, weight: 600, fill: '#e8eeff' }),
    text(x + 34, y + 274, 'plus multi-industry jobs across India.', { size: 24, weight: 600, fill: '#e8eeff' }),
    ...(() => {
      let cursor = x + 34
      return ['3 live jobs', '2 MR roles', '1 pinned'].map((label) => {
        const made = pill(cursor, y + 312, label, { size: 24, fill: '#ffffff', color: C.brandDark, weight: 700, h: 48, padX: 20 })
        const svg = made.svg.replace('#ffffff', 'rgba(255,255,255,0.92)')
        cursor += made.w + 12
        return svg
      })
    })(),
  ].join('')
}

/** Search field + Filters button. */
function searchRow(y) {
  return [
    rect(32, y, 730, 88, { r: 22, fill: C.white, stroke: C.line }),
    circle(84, y + 42, 13, 'none'),
    `<circle cx="84" cy="${y + 40}" r="13" fill="none" stroke="#94a3b8" stroke-width="4"/>`,
    `<path d="M94 ${y + 50} l12 12" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/>`,
    text(122, y + 54, 'Search job title, company, skill…', { size: 26, weight: 500, fill: '#94a3b8' }),
    rect(784, y, 264, 88, { r: 22, fill: C.white, stroke: C.line }),
    text(848, y + 54, 'Filters', { size: 26, weight: 700 }),
  ].join('')
}

/** Horizontally scrolling category chips; the first one is selected. */
function chips(y, labels) {
  let cursor = 32
  return labels.map((label, index) => {
    const selected = index === 0
    const made = pill(cursor, y, label, {
      size: 25,
      weight: 600,
      h: 66,
      padX: 26,
      fill: selected ? C.brand : C.white,
      color: selected ? C.white : C.body,
      stroke: selected ? null : C.line,
    })
    cursor += made.w + 14
    return made.svg
  }).join('')
}

/** Grey bar standing in for the blurred company name on a locked card. */
const lockedBar = (x, y) => rect(x, y, 300, 26, { r: 13, fill: '#cbd5e1' })

function jobIcon(x, y) {
  return [
    rect(x, y, 96, 96, { r: 24, fill: C.brand }),
    rect(x + 22, y + 30, 52, 40, { r: 10, fill: C.white }),
    rect(x + 44, y + 20, 10, 18, { r: 4, fill: C.white }),
    // padlock
    rect(x + 62, y + 52, 18, 14, { r: 4, fill: C.brand }),
    `<path d="M66 ${y + 56} a5 5 0 0 1 10 0" fill="none" stroke="${C.brand}" stroke-width="3"/>`,
  ].join('')
}

/** One job card, locked (free user) or unlocked (subscriber). */
function jobCard(y, job) {
  const x = 32
  const w = W - 64
  // Height is derived from the content, so a card can never clip its own
  // footer: chips row, one line per bullet, then the age + button rows.
  const h = 394 + job.points.length * 38
  const body = []
  body.push(rect(x, y, w, h, { r: 26, fill: C.white, stroke: C.line }))
  body.push(jobIcon(x + 30, y + 26))
  const tx = x + 152
  body.push(text(tx, y + 58, job.title, { size: 34, weight: 700 }))
  if (job.pinned) {
    const made = pill(tx + measure(job.title, 34) + 14, y + 20, 'Pinned', {
      size: 22, weight: 700, fill: C.amberBg, color: C.amber, stroke: C.amberLine, h: 42, padX: 16,
    })
    body.push(made.svg)
  }
  body.push(`<path d="M${tx + 6} ${y + 82} l-7 20 h14 z" fill="#ef4444"/>`)
  body.push(text(tx + 26, y + 102, job.city, { size: 27, weight: 600, fill: C.body }))
  body.push(lockedBar(tx + 26, y + 124))
  body.push(text(tx + 342, y + 146, 'LOCKED', { size: 24, weight: 800, fill: C.amber }))
  let chipX = tx + 26
  for (const [i, label] of job.chips.entries()) {
    const made = pill(chipX, y + 166, label, {
      size: 23, weight: 600, h: 46, padX: 18,
      fill: i === 1 ? C.greenBg : C.brandSoft,
      color: i === 1 ? C.green : C.brandDark,
      stroke: i === 1 ? C.greenLine : null,
    })
    body.push(made.svg)
    chipX += made.w + 12
  }
  job.points.forEach((point, index) => {
    const lineY = y + 248 + index * 38
    body.push(circle(tx + 32, lineY - 8, 5, C.brand))
    body.push(text(tx + 50, lineY, point, { size: 26, weight: 500, fill: C.body }))
  })
  body.push(text(tx + 26, y + h - 120, job.age, { size: 22, weight: 500, fill: '#94a3b8' }))
  const badgeWidth = measure('Subscribe to unlock', 22, 700) + 32
  body.push(pill(x + w - 26 - badgeWidth, y + h - 142, 'Subscribe to unlock', {
    size: 22, weight: 700, fill: C.amberBg, color: C.amber, stroke: C.amberLine, h: 44, padX: 16,
  }).svg)
  body.push(rect(x + 26, y + h - 84, w - 52, 72, { r: 18, fill: C.brand }))
  body.push(text(x + w / 2, y + h - 38, '▶  Watch video to unlock company name', {
    size: 27, weight: 700, fill: C.white, anchor: 'middle',
  }))
  return body.join('')
}

function sectionHead(y, left, right) {
  return [
    text(32, y, left, { size: 30, weight: 700 }),
    pill(W - 200, y - 40, right, { size: 22, weight: 700, fill: C.brandSoft, color: C.brandDark, h: 44, padX: 18 }).svg,
  ].join('')
}

const frame = (content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${rect(0, 0, W, H, { fill: C.page })}
    ${statusBar()}
    ${content}
  </svg>`

// --- 1. Home feed ------------------------------------------------------------
const home = frame([
  appHeader(),
  hero(),
  searchRow(666),
  chips(778, ['All', 'MR', 'ABM', 'Part-time', 'E-commerce', 'Finance']),
  sectionHead(906, 'MR-first feed', '3 roles'),
  jobCard(940, {
    title: 'Medical Representative', pinned: true, city: 'Tumkur',
    chips: ['MR', '2.8 to 3.30', '0-6 months'],
    points: ['Promote company products', 'To meet doctors regularly'],
    age: '21d ago · 14 Oct 2026',
  }),
  jobCard(1426, {
    title: 'TERRITORY MANAGER', city: 'BELLARY',
    chips: ['MR', '3-6 LPA', '1-2 YEAR'],
    points: ['Role Overview:', 'Visit doctors regularly to promote company products'],
    age: '23d ago · 12 Oct 2026',
  }),
].join(''))

// --- 2. Unlock a company name with a short video -----------------------------
const unlock = frame([
  appHeader(),
  sectionHead(300, 'Pinned for you', '1 job'),
  jobCard(340, {
    title: 'Medical Representative', pinned: true, city: 'Tumkur',
    chips: ['MR', '2.8 to 3.30', '0-6 months'],
    points: ['Promote company products', 'To meet doctors regularly', 'Territory: Tumkur, Karnataka'],
    age: '21d ago · 14 Oct 2026',
  }),
  rect(32, 940, W - 64, 268, { r: 26, fill: C.white, stroke: C.line }),
  text(64, 1006, 'Company names are free', { size: 34, weight: 700 }),
  text(64, 1058, 'Watch one short video to reveal this company’s name.', { size: 26, weight: 500, fill: C.body }),
  text(64, 1100, 'It stays unlocked on your account — no daily limit,', { size: 26, weight: 500, fill: C.body }),
  text(64, 1136, 'nothing to pay, every job unlocked separately.', { size: 26, weight: 500, fill: C.body }),

  rect(32, 1240, W - 64, 236, { r: 26, fill: C.amberBg, stroke: C.amberLine }),
  text(64, 1304, 'One-time passes, no auto-renew', { size: 32, weight: 700, fill: C.amber }),
  text(64, 1358, 'Manager name, manager email and both numbers for', { size: 25, weight: 500, fill: '#78350f' }),
  text(64, 1396, 'every job — from ₹19 for 1 day to ₹1799 for 1 year.', { size: 25, weight: 500, fill: '#78350f' }),

  rect(32, 1508, W - 64, 320, { r: 26, fill: C.white, stroke: C.line }),
  text(64, 1570, 'How an unlock works', { size: 30, weight: 700 }),
  ...[
    'Tap the video button on a locked job',
    'Finish the short video — the company name appears',
    'Apply with your profile whenever you are ready',
  ].flatMap((line, index) => [
    rect(64, 1602 + index * 66, 44, 44, { r: 22, fill: C.brandSoft }),
    text(86, 1633 + index * 66, String(index + 1), { size: 24, weight: 700, fill: C.brandDark, anchor: 'middle' }),
    text(126, 1633 + index * 66, line, { size: 25, weight: 500, fill: C.body }),
  ]),
].join(''))

// --- 3. Job detail with the description and Apply ----------------------------
const details = frame([
  appHeader(),
  rect(32, 262, W - 64, 250, { r: 26, fill: C.white, stroke: C.line }),
  jobIcon(64, 294),
  text(188, 336, 'Medical Representative', { size: 38, weight: 700 }),
  text(188, 388, 'Tumkur, Karnataka', { size: 27, weight: 600, fill: C.body }),
  pill(188, 410, 'MR', { size: 23, weight: 600, fill: C.brandSoft, color: C.brandDark, h: 44, padX: 16 }).svg,
  pill(292, 410, '2.8 to 3.30 LPA', { size: 23, weight: 600, fill: C.greenBg, color: C.green, stroke: C.greenLine, h: 44, padX: 16 }).svg,
  pill(520, 410, '0-6 months', { size: 23, weight: 600, fill: C.slateChip, h: 44, padX: 16 }).svg,
  text(64, 556, 'Company', { size: 20, weight: 700, fill: C.muted, spacing: 1.2 }),
  text(64, 606, '✓ Unlocked for this job', { size: 30, weight: 700, fill: C.green }),

  rect(32, 646, W - 64, 470, { r: 26, fill: C.white, stroke: C.line }),
  text(64, 706, 'Description', { size: 30, weight: 700 }),
  ...[
    'Promote company products to doctors, chemists and stockists',
    'Meet doctors regularly and build lasting prescriptions',
    'Cover the Tumkur territory with a daily field plan',
    'Report daily activity and doctor coverage to the manager',
  ].flatMap((line, index) => [
    circle(74, 756 + index * 62, 5, C.brand),
    text(94, 766 + index * 62, line, { size: 25, weight: 500, fill: C.body }),
  ]),
  text(64, 1044, 'Manager name, email and both numbers unlock with a pass.', { size: 23, weight: 600, fill: C.muted }),

  rect(32, 1150, W - 64, 232, { r: 26, fill: C.white, stroke: C.line }),
  text(64, 1210, 'Manager contact', { size: 30, weight: 700 }),
  rect(64, 1240, 440, 60, { r: 14, fill: '#f1f5f9' }),
  text(84, 1280, 'Manager name', { size: 24, weight: 600, fill: '#94a3b8' }),
  rect(524, 1240, 440, 60, { r: 14, fill: '#f1f5f9' }),
  text(544, 1280, 'Phone number', { size: 24, weight: 600, fill: '#94a3b8' }),
  rect(64, 1316, 440, 48, { r: 14, fill: '#f1f5f9' }),
  text(84, 1348, 'Email', { size: 24, weight: 600, fill: '#94a3b8' }),
  rect(524, 1316, 440, 48, { r: 14, fill: '#f1f5f9' }),
  text(544, 1348, 'Alternate number', { size: 24, weight: 600, fill: '#94a3b8' }),

  rect(32, 1416, W - 64, 268, { r: 26, fill: C.white, stroke: C.line }),
  text(64, 1476, 'Job details', { size: 30, weight: 700 }),
  ...[
    ['Category', 'MR (Medical Representative)'],
    ['Experience', '0-6 months'],
    ['Salary', '2.8 to 3.30 LPA'],
    ['Location', 'Tumkur, Karnataka'],
  ].flatMap(([label, value], index) => [
    text(64, 1524 + index * 42, label, { size: 24, weight: 500, fill: C.muted }),
    text(W - 64, 1524 + index * 42, value, { size: 24, weight: 700, fill: C.ink, anchor: 'end' }),
  ]),

  rect(32, 1716, W - 64, 96, { r: 20, fill: C.brand }),
  text(W / 2, 1776, 'Apply now', { size: 32, weight: 700, fill: C.white, anchor: 'middle' }),
  text(W / 2, 1848, 'Your application opens in your mail app or WhatsApp, ready to send.', {
    size: 22, weight: 500, fill: C.muted, anchor: 'middle',
  }),
].join(''))

// --- 4. Plans with the live prices -------------------------------------------
const planRow = (y, { title, days, price, popular = false, active = false }) => {
  const rows = [rect(32, y, W - 64, 250, {
    r: 26,
    fill: C.white,
    stroke: popular ? C.brand : C.line,
    sw: popular ? 4 : 2,
  })]
  rows.push(text(64, y + 70, title, { size: 34, weight: 700 }))
  rows.push(text(64, y + 112, days, { size: 25, weight: 600, fill: C.body }))
  rows.push(text(W - 64, y + 74, price, { size: 40, weight: 700, fill: C.brand, anchor: 'end' }))
  if (popular) {
    rows.push(rect(W - 264, y - 20, 232, 48, { r: 24, fill: C.brand }))
    rows.push(text(W - 148, y + 12, 'Most popular', { size: 21, weight: 700, fill: C.white, anchor: 'middle' }))
  }
  if (active) {
    rows.push(rect(W - 264, y - 20, 232, 48, { r: 24, fill: C.greenBg, stroke: C.greenLine }))
    rows.push(text(W - 148, y + 12, '✓ Active', { size: 21, weight: 700, fill: C.green, anchor: 'middle' }))
  }
  rows.push(rect(64, y + 152, W - 128, 76, { r: 18, fill: popular ? C.brand : C.white, stroke: popular ? null : C.line, sw: 2 }))
  rows.push(text(W / 2, y + 200, popular ? 'Choose this plan' : 'Select plan', {
    size: 27, weight: 700, fill: popular ? C.white : C.ink, anchor: 'middle',
  }))
  return rows.join('')
}

const plans = frame([
  appHeader(),
  rect(32, 262, W - 64, 210, { r: 26, fill: C.brandSoft, stroke: C.brand }),
  text(64, 318, 'SUBSCRIPTION', { size: 20, weight: 700, fill: C.brandDark, spacing: 2 }),
  text(64, 370, 'Unlock company details and apply', { size: 34, weight: 700 }),
  text(64, 414, 'Pay with Google Play. Access starts once the server', { size: 24, weight: 500, fill: C.body }),
  text(64, 446, 'verifies your purchase. One-time passes — no auto-renew.', { size: 24, weight: 500, fill: C.body }),

  planRow(500, { title: '1 Day Trial', days: '1 day of access', price: '₹19' }),
  planRow(796, { title: '15 Days Pro', days: '15 days of access', price: '₹149', popular: true }),
  planRow(1092, { title: '30 Days Standard', days: '30 days of access', price: '₹249' }),
  planRow(1380, { title: '1 Year Ultimate', days: '365 days of access', price: '₹1799' }),

  rect(32, 1662, W - 64, 226, { r: 26, fill: C.white, stroke: C.line }),
  text(64, 1718, 'Every pass includes', { size: 30, weight: 700 }),
  ...[
    'Company, manager, email and both contact numbers',
    'One-tap Apply with your profile and resume ready',
    '10, 90 and 180-day passes are in the app too',
  ].flatMap((line, index) => [
    circle(74, 1758 + index * 36, 5, C.brand),
    text(94, 1768 + index * 36, line, { size: 24, weight: 500, fill: C.body }),
  ]),
].join(''))

const screens = [
  ['screenshot-1-home.png', home],
  ['screenshot-2-unlock.png', unlock],
  ['screenshot-3-details.png', details],
  ['screenshot-4-plans.png', plans],
]

for (const [name, svg] of screens) {
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { loadSystemFonts: true, defaultFontFamily: FONT },
  }).render()
  if (rendered.width !== W || rendered.height !== H) {
    throw new Error(`${name}: rendered ${rendered.width}x${rendered.height}, expected ${W}x${H}`)
  }
  const png = opaquePng(W, H, rendered.pixels)
  if (png.readUInt8(25) !== 2) throw new Error(`${name}: not written as opaque RGB`)
  writeFileSync(resolve(OUT, name), png)
  console.log(`${name} ${W}x${H} opaque`)
}
