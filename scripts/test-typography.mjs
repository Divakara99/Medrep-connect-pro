import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { salaryParts } from '../src/data/salaryText.ts'

/**
 * The look the owner asked for, in rules:
 *
 *   * one typeface across the project — geometric, with a real italic —
 *     bundled with the app, not fetched from a font CDN;
 *   * one type scale, one step larger than the browser default;
 *   * the job card follows the compact reference layout: full-width title,
 *     company and location lines, salary, compact metadata chips and actions;
 *   * the long description does not come back to the card — it stays on its
 *     own page.
 */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

// 1. One typeface, bundled ----------------------------------------------------
const css = await read('src/index.css')
assert.match(css, /@import "@fontsource-variable\/montserrat\/wght\.css"/, 'the upright face is bundled')
assert.match(css, /@import "@fontsource-variable\/montserrat\/wght-italic\.css"/, 'and so is the true italic')
assert.match(css, /--font-sans: "Montserrat Variable"/, 'the whole project uses it')
assert.doesNotMatch(css, /fonts\.googleapis|fonts\.gstatic/, 'nothing is fetched from a font CDN')

const pkg = JSON.parse(await read('package.json'))
assert.ok(pkg.devDependencies['@fontsource-variable/montserrat'], 'the font is a pinned dependency')

// 2. One type scale -----------------------------------------------------------
for (const [token, size] of [
  ['--text-xs', '0.8125rem'],
  ['--text-sm', '0.9375rem'],
  ['--text-base', '1.0625rem'],
  ['--text-lg', '1.1875rem'],
  ['--text-xl', '1.3125rem'],
  ['--text-2xl', '1.5625rem'],
  ['--text-3xl', '1.9375rem'],
]) {
  assert.match(css, new RegExp(`${token}: ${size.replace('.', '\\.')}`), `${token} is ${size}`)
}
assert.match(css, /--text-sm--line-height/, 'each step carries its own line height')

// 3. Salary text splits cleanly ----------------------------------------------
assert.deepEqual(salaryParts('₹ 10,000 - ₹ 15,000 / month'), { amount: '₹ 10,000 - ₹ 15,000', unit: '/ month' })
assert.deepEqual(salaryParts('₹ 25,000 - ₹ 50,000/month'), { amount: '₹ 25,000 - ₹ 50,000', unit: '/ month' })
assert.deepEqual(salaryParts('₹ 18,000 per month'), { amount: '₹ 18,000', unit: '/ month' })
assert.deepEqual(salaryParts('₹ 18,000 a month'), { amount: '₹ 18,000', unit: '/ month' })
assert.deepEqual(salaryParts('₹ 12 LPA'), { amount: '₹ 12 LPA', unit: '' }, 'an odd salary is shown whole')
assert.deepEqual(salaryParts('   '), { amount: '', unit: '' }, 'no salary, no row')
assert.deepEqual(salaryParts(undefined), { amount: '', unit: '' })

// 4. The card ----------------------------------------------------------------
const card = await read('src/components/JobCard.tsx')
assert.match(card, /salaryParts\(job\.salary\)/, 'the card splits the salary period')
assert.match(card, /text-\[13px\] font-extrabold !leading-\[1\.1\] tracking-tight/, 'the full-width job title is compact and wraps clearly')
assert.match(card, /text-\[11px\] font-semibold !leading-tight text-slate-700/, 'the company name sits close below the title')
assert.match(card, /break-words text-\[11px\] font-medium !leading-tight text-slate-700/, 'location text wraps with tighter line spacing')
assert.match(card, /rounded-full bg-emerald-50/, 'salary uses the soft green reference chip')
assert.match(card, /rounded-full bg-sky-50/, 'experience sits in a compact sky chip')
assert.match(card, /rounded-full bg-violet-50/, 'category sits in a compact violet chip')
assert.match(card, /onApply\(job\)/, 'the green apply action uses the existing application flow')
assert.match(card, /const applyAccessibleLabel = 'Choose how to apply'/, 'Apply prompts the user to choose a contact method')
assert.match(card, /onWatchUnlock && !companyUnlocked/, 'the card offers a rewarded video for locked companies when the app provides the eligible-user callback')
assert.doesNotMatch(card, /showUnlockButton = Boolean\(onWatchUnlock && job\.company/, 'company names are intentionally hidden before video unlock and cannot gate the button')
assert.match(card, /{showUnlockButton && \(/, 'the rewarded action stays in the card action area')
assert.match(card, /flex items-center gap-1 border-t border-slate-100 px-2\.5 py-1/, 'Apply and Watch video share one compact horizontal row')
assert.match(card, /h-8 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg/, 'both actions stay on one line as compact, equal-width buttons')
assert.match(card, /const applyLabel = 'Apply'/, 'the card action is labeled Apply before channel selection')
assert.match(card, /'Watch video'/, 'the rewarded action has a short label for the shared row')
assert.match(card, /border-t border-\[#eef1f8\] px-2\.5 py-1/, 'the compact metadata strip closes the card body')
assert.match(card, /rounded-xl border-2 border-slate-300/, 'the card has a clearly visible outline')
assert.doesNotMatch(card, /job\.manager|job\.contact|Manager:|Contact:/, 'manager and contact details appear only in Job Details')
assert.match(card, /<LockIcon/, 'locked company details are identified without a large tile')
assert.match(card, /<MoneyIcon/, 'the salary row has its own icon')
assert.match(card, /<PinIcon/, 'and so does the city')
assert.match(card, /<ChevronIcon/, 'the card offers a clear way in')
assert.doesNotMatch(card, /descriptionPoints/, 'the description preview does not come back to the card')
assert.doesNotMatch(card, /just now|JsxElement/, 'nothing stray')
assert.match(card, /'Contact locked'/, 'the lock is still stated plainly')
assert.match(card, /\\u2713 Unlocked|✓ Unlocked/, 'and unlocked is still stated')

// 5. The feed header reads like the reference --------------------------------
const home = await read('src/screens/HomeScreen.tsx')
assert.match(home, /Apply to these jobs/, 'the feed is headed plainly')
assert.match(home, /text-lg font-extrabold leading-tight tracking-tight text-slate-900/, 'the results heading is compact and upright')
assert.match(home, /space-y-3 px-4 pb-8 pt-4/, 'the home screen uses tighter vertical spacing around the search and category controls')
assert.match(home, /rounded-2xl border border-slate-300 bg-white\/95 p-1\.5/, 'the search sheet is compact with a visible edge')
assert.match(home, /px-3 py-1\.5 text-xs font-bold transition/, 'category chips use compact sizing')
assert.match(home, /text-xs font-medium italic text-slate-500/, 'the line under it is italic and compact')

console.log('typography: one bundled typeface, one larger scale, the reference job card — passed')
