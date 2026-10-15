#!/usr/bin/env node
/**
 * Android launcher icons from the same single source of truth as every other
 * icon (src/assets/logo.svg → <g id="mrc-mark">). Run: npm run icons:android
 *
 * Writes per-density ic_launcher / ic_launcher_round (full-bleed tile) and
 * ic_launcher_foreground (glyph in the adaptive safe zone over transparency,
 * background = brand colour in values/ic_launcher_background.xml).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(ROOT, 'src/assets/logo.svg'), 'utf8')
const defs = source.match(/<defs>[\s\S]*?<\/defs>/)?.[0]
if (!defs) throw new Error('logo.svg <defs> not found')

const BLEED = '<rect width="512" height="512" fill="url(#mrc-tile)"/>'
const mark = (factor) => factor === 1
  ? '<use href="#mrc-mark"/>'
  : `<g transform="translate(256 256) scale(${factor}) translate(-256 -256)"><use href="#mrc-mark"/></g>`
const doc = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${body}</svg>\n`

function render(svg, size) {
  const png = Buffer.from(new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false, defaultFontFamily: 'sans-serif' },
  }).render().asPng())
  if (png.readUInt32BE(16) !== size) throw new Error(`bad size ${size}`)
  return png
}

const densities = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]

for (const [density, launcherSize, foregroundSize] of densities) {
  const dir = resolve(ROOT, `android/app/src/main/res/mipmap-${density}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'ic_launcher.png'), render(doc(BLEED + mark(1)), launcherSize))
  writeFileSync(resolve(dir, 'ic_launcher_round.png'), render(doc(BLEED + mark(1)), launcherSize))
  writeFileSync(resolve(dir, 'ic_launcher_foreground.png'), render(doc(mark(0.62)), foregroundSize))
  console.log(`mipmap-${density}: launcher ${launcherSize}px, foreground ${foregroundSize}px`)
}
console.log('Android launcher icons regenerated from src/assets/logo.svg')
