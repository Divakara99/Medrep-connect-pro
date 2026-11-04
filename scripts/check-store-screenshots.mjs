import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Play Store phone-screenshot check (npm run store:screenshots).
 *
 * Google Play rejects a listing for the wrong size before a human ever looks at
 * it: PNG or JPEG, between 320 and 3840 px on each side, no transparency, at
 * most 8 MB, and a 9:16-ish portrait frame. This reads the real headers (no
 * image library) and says which file breaks which rule.
 *
 * The four files are also expected to carry the names from SCREENSHOTS.md so the
 * repo, the listing and the upload order stay in step.
 */
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIR = join(ROOT, 'store-listing')
const EXPECTED = [
  'screenshot-1-home.png',
  'screenshot-2-unlock.png',
  'screenshot-3-details.png',
  'screenshot-4-plans.png',
]

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Width, height, colour type and whether the format is PNG or JPEG. */
function describe(buffer) {
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      format: 'png',
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      colorType: buffer.readUInt8(25), // 6 = RGBA, 4 = grey+alpha
    }
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xff) { offset += 1; continue }
      const marker = buffer[offset + 1]
      // SOF0..SOF15, skipping the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: 'jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      offset += 2 + buffer.readUInt16BE(offset + 2)
    }
    return { format: 'jpeg', width: 0, height: 0 }
  }
  return null
}

const files = (await readdir(DIR)).filter((name) => /^screenshot-\d.*\.(png|jpe?g)$/i.test(name))
const problems = []
const found = []

for (const name of files) {
  const path = join(DIR, name)
  const buffer = await readFile(path)
  const info = describe(buffer)
  if (!info) {
    problems.push(`${name}: not a PNG or JPEG`)
    continue
  }
  const megabytes = buffer.length / (1024 * 1024)
  const ratio = info.width / info.height
  found.push({ name, ...info, megabytes, ratio })
  if (info.width < 320 || info.height < 320) problems.push(`${name}: ${info.width}x${info.height} is below Play's 320px minimum`)
  if (info.width > 3840 || info.height > 3840) problems.push(`${name}: ${info.width}x${info.height} is above Play's 3840px maximum`)
  if (megabytes > 8) problems.push(`${name}: ${megabytes.toFixed(1)} MB is above Play's 8 MB limit`)
  if (info.format === 'png' && (info.colorType === 6 || info.colorType === 4)) problems.push(`${name}: PNG has an alpha channel — Play wants an opaque image`)
  if (info.height <= info.width) problems.push(`${name}: not portrait (${info.width}x${info.height}); phone screenshots must be taller than wide`)
  if (ratio < 0.5 || ratio > 0.65) problems.push(`${name}: ${info.width}x${info.height} is not a 9:16 portrait frame`)
}

for (const name of EXPECTED) {
  if (!files.some((file) => file.toLowerCase() === name)) problems.push(`${name}: missing (see store-listing/SCREENSHOTS.md)`)
}

for (const item of found.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`${item.name}  ${item.width}x${item.height}  ${item.format.toUpperCase()}  ${item.megabytes.toFixed(2)} MB`)
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`)
  process.exit(1)
}

console.log('store screenshots: four portrait captures, correct size, opaque, under 8 MB')
