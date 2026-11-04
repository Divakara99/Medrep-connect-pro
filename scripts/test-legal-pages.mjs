import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * Legal pages that Google Play links to.
 *
 * Play requires the Terms of Service URL to be a plain, publicly reachable page
 * (not a PDF), and both store forms point at medrepconnect.in. These checks keep
 * the two published pages in the build, free of placeholders, and honest about
 * how each channel charges:
 *
 *   - Android: Google Play Billing  (never Razorpay)
 *   - Website: Razorpay Checkout    (never ads)
 */
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const pages = {
  terms: await read('public/terms.html'),
  privacy: await read('public/privacy-policy.html'),
}

for (const [name, html] of Object.entries(pages)) {
  assert.match(html, /^<!doctype html>/i, `${name}: must be a standalone HTML page`)
  assert.match(html, /<meta name="viewport"/i, `${name}: must be readable on a phone`)
  assert.match(html, /Last updated:/i, `${name}: must carry a date`)
  assert.doesNotMatch(html, /\[Owner[^\]]*\]/, `${name}: unfinished owner placeholder`)
  assert.doesNotMatch(html, /\bTBD\b|\bTODO\b|\bLorem ipsum\b/i, `${name}: placeholder text`)
  // Play's own requirement: not a PDF or a downloadable file.
  assert.doesNotMatch(html, /application\/pdf/i, `${name}: must not be a PDF link wrapper`)
}

// The two pages are separate documents, each self-contained.
assert.match(pages.terms, /Terms of Service/i)
assert.match(pages.privacy, /Privacy Policy/i)

// Android charges through Google Play; the website through Razorpay. Both pages
// must describe the app the user actually has in their hands.
assert.match(pages.terms, /Google Play Billing/, 'terms must describe in-app purchases')
assert.match(pages.terms, /Razorpay/, 'terms must still describe website payments')
assert.match(pages.terms, /Google Play refund policy|refunded by Google/i, 'terms must say who refunds Play purchases')
assert.match(pages.terms, /AdMob/, 'terms must disclose advertising in the Android app')
assert.match(pages.terms, /privacy-policy\.html/, 'terms must link the privacy policy')
assert.match(pages.privacy, /medrepconnect\.in/, 'privacy page must name the service domain')

// Contact details Play already publishes for this developer.
assert.match(pages.terms, /mglover961994@gmail\.com/, 'support email must be the published one')

// The in-app terms (src/data/terms.ts) must not contradict the published page.
const inApp = await read('src/data/terms.ts')
assert.doesNotMatch(inApp, /\[Owner/, 'in-app terms still contain an owner placeholder')
assert.match(inApp, /Google Play Billing/, 'in-app terms must describe in-app purchases')
assert.match(inApp, /Razorpay/, 'in-app terms must still describe website payments')
assert.match(inApp, /privacy-policy\.html/, 'in-app terms must link the privacy policy')

console.log('legal pages: terms + privacy publish, no placeholders, both payment channels and ads disclosed')
