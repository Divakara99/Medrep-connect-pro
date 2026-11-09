import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * Plan wording (src/data/planDisplay.ts — the shipping source).
 *
 * The catalog is edited by hand, so a row can read "1 Days Trial". These rules
 * keep the screen grammatical without a production data write, and keep every
 * duration phrase in one place.
 */
const source = await readFile(new URL('../src/data/planDisplay.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: 'planDisplay.ts',
}).outputText
const file = join(process.env.TMPDIR || '/tmp', `mrc-plandisplay-${process.pid}.mjs`)
await writeFile(file, javascript)
const { planTitle, daysLabel, accessLabel, periodLabel, paymentDayStart, paymentDayLabel, paymentStatusLabel } = await import(pathToFileURL(file).href)

// The live row that reads badly today.
assert.equal(planTitle('1 Days Trial'), '1 Day Trial')

// Everything else is left exactly as the catalog wrote it.
assert.equal(planTitle('10 Days Basic'), '10 Days Basic')
assert.equal(planTitle('15 Days Pro'), '15 Days Pro')
assert.equal(planTitle('3 Months Premium'), '3 Months Premium')
assert.equal(planTitle('1 Year Ultimate'), '1 Year Ultimate')
assert.equal(planTitle('11 Days Offer'), '11 Days Offer', 'a multi-day plan starting with 1 must not be rewritten')
assert.equal(planTitle('21 Days Plan'), '21 Days Plan')
assert.equal(planTitle('  Spaced  '), 'Spaced')
assert.equal(planTitle(''), 'Plan', 'an empty title still renders something')

assert.equal(daysLabel(1), '1 day')
assert.equal(daysLabel(15), '15 days')
assert.equal(daysLabel(365), '365 days')
assert.equal(daysLabel(0), '1 day', 'a zero-day row never renders "0 days"')
assert.equal(daysLabel(Number.NaN), '1 day')

assert.equal(accessLabel(1), '1 day of access')
assert.equal(accessLabel(30), '30 days of access')

assert.equal(periodLabel(1), '1 day')
assert.equal(periodLabel(10), '10 days')
assert.equal(periodLabel(30), '1 month')
assert.equal(periodLabel(90), '3 months')
assert.equal(periodLabel(365), '1 year')

// Payment history reads date by date: the heading must be the day the payment
// happened in local time, and "Today"/"Yesterday" must not drift.
const now = new Date(2026, 10, 9, 9, 35).getTime()   // 9 Nov 2026, 09:35 local
assert.equal(paymentDayLabel(paymentDayStart(now), now), 'Today')
assert.equal(paymentDayLabel(paymentDayStart(new Date(2026, 10, 8, 23, 55).getTime()), now), 'Yesterday')
assert.equal(paymentDayLabel(paymentDayStart(new Date(2026, 10, 7, 12, 0).getTime()), now), '7 Nov 2026')
// Late-night and just-after-midnight payments are different days.
assert.notEqual(
  paymentDayStart(new Date(2026, 10, 8, 23, 55).getTime()),
  paymentDayStart(new Date(2026, 10, 9, 0, 5).getTime()),
  '23:55 and 00:05 belong to different days',
)

assert.equal(paymentStatusLabel('success'), 'Paid')
assert.equal(paymentStatusLabel('pending'), 'Pending')
assert.equal(paymentStatusLabel('failed'), 'Failed')
assert.equal(paymentStatusLabel('rejected'), 'Rejected')
assert.equal(paymentStatusLabel('pending', true), 'Awaiting UPI verification', 'a manual UPI review says so')

const plansScreen = await readFile(new URL('../src/screens/PlansScreen.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(plansScreen, /<table/, 'payment history is no longer a sideways-scrolling table')
assert.match(plansScreen, /historyGroups\.map/, 'history is grouped day by day')
assert.match(plansScreen, /🧾 Receipt/, 'each payment has a receipt button')
assert.match(plansScreen, /title="Payment receipt"/, 'the receipt opens from the row')
assert.match(plansScreen, /paymentDayLabel\(dayStart\)/, 'day headings come from the shared helper')

console.log('plan display: singular title, no "1 days", day/month/year labels correct, history grouped by day with receipts')
