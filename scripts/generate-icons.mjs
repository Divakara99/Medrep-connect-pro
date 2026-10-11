#!/usr/bin/env node
/**
 * Icon generator — ONE source of truth, every icon derived from it.
 *
 *   source : src/assets/logo.svg   (also imported directly by src/components/Logo.tsx)
 *
 *   writes : public/favicon.svg            vector copy, browser tab
 *            public/icon-192.png           PWA icon, purpose "any"
 *            public/icon-512.png           PWA icon, purpose "any"
 *            public/apple-touch-icon.png   180px, full-bleed (iOS applies its own mask)
 *            public/maskable-512.png       512px, full-bleed + Android safe zone
 *
 *   usage  : npm run icons
 *
 * The artwork lives exactly once, as <g id="mrc-mark"> inside <defs>. Each
 * variant below re-references that same group, so the glyph rendered in the app
 * header, the favicon and the installed PWA icon can never drift apart.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(ROOT, 'src/assets/logo.svg')
const OUT = resolve(ROOT, 'public')

const source = readFileSync(SOURCE, 'utf8')

// Reuse the single <defs> block (gradients + the brand glyph) verbatim.
const defs = source.match(/<defs>[\s\S]*?<\/defs>/)
if (!defs) {
  throw new Error(
    `Could not find a <defs> block in ${SOURCE}.\n` +
      'The generator expects the artwork to live once inside <defs> as <g id="mrc-mark">.',
  )
}
if (!/<g id="mrc-mark"/.test(defs[0])) {
  throw new Error(`Expected <g id="mrc-mark"> inside <defs> of ${SOURCE}.`)
}

/** Full-bleed background: no corner rounding, the OS supplies the mask shape. */
const BLEED = '<rect width="512" height="512" fill="url(#mrc-tile)"/>'

/** Rounded app tile: the corner radius is part of the artwork (112 / 512 ≈ 22%). */
const TILE =
  '<rect width="512" height="512" rx="112" fill="url(#mrc-tile)"/>' +
  '<rect width="512" height="512" rx="112" fill="url(#mrc-gloss)"/>'

/**
 * Wrap the glyph in a scale about the canvas centre.
 * @param {number} factor 1 = edge-to-edge artwork, <1 = pulls it inside the safe zone.
 */
const mark = (factor = 1) =>
  factor === 1
    ? '<use href="#mrc-mark"/>'
    : `<g transform="translate(256 256) scale(${factor}) translate(-256 -256)"><use href="#mrc-mark"/></g>`

const svgDoc = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs[0]}${body}</svg>\n`

/** Render an SVG document to a PNG buffer of exactly `size` × `size` pixels. */
function renderPng(doc, size) {
  const resvg = new Resvg(doc, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0, 0, 0, 0)',
    // The artwork is pure vector paths — never pull in host fonts, so output is
    // byte-identical on any machine (CI included).
    font: { loadSystemFonts: false, defaultFontFamily: 'sans-serif' },
  })
  const png = Buffer.from(resvg.render().asPng())
  // PNG IHDR: width @16, height @20 — fail loudly rather than ship a wrong size.
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  if (w !== size || h !== size) {
    throw new Error(`Rendered ${w}x${h} but expected ${size}x${size}`)
  }
  return png
}

/** PNG bytes → human readable size, for the summary line. */
const kb = (buf) => `${(buf.length / 1024).toFixed(1)} KB`

const written = []

// 1. Vector favicon — a copy of the source so the well-known public URL stays stable.
const favicon = Buffer.from(source, 'utf8')
writeFileSync(resolve(OUT, 'favicon.svg'), favicon)
written.push(['public/favicon.svg', 'vector', kb(favicon)])

// 2. PWA "any" icons — the rounded tile, rendered at both required sizes.
const tileDoc = svgDoc(TILE + mark(1))
for (const size of [192, 512]) {
  const png = renderPng(tileDoc, size)
  const name = `icon-${size}.png`
  writeFileSync(resolve(OUT, name), png)
  written.push([`public/${name}`, `${size}x${size}`, kb(png)])
}

// 3. apple-touch-icon — iOS masks + adds its own rounding, so ship it full-bleed
//    (a rounded tile here shows white corners on the home screen).
const apple = renderPng(svgDoc(BLEED + mark(1)), 180)
writeFileSync(resolve(OUT, 'apple-touch-icon.png'), apple)
written.push(['public/apple-touch-icon.png', '180x180', kb(apple)])

// 4. Maskable — Android adaptive icons crop to circle/squircle/drop, so keep the
//    glyph inside the inner 80% safe zone (0.72 leaves room for the stroke).
const maskable = renderPng(svgDoc(BLEED + mark(0.72)), 512)
writeFileSync(resolve(OUT, 'maskable-512.png'), maskable)
written.push(['public/maskable-512.png', '512x512 maskable', kb(maskable)])

const width = Math.max(...written.map(([f]) => f.length))
console.log(`Generated ${written.length} icons from src/assets/logo.svg:`)
for (const [file, size, bytes] of written) {
  console.log(`  ${file.padEnd(width)}  ${size.padEnd(18)} ${bytes}`)
}
