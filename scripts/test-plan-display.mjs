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
const { planTitle, daysLabel, accessLabel, periodLabel } = await import(pathToFileURL(file).href)

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

console.log('plan display: singular title, no "1 days", day/month/year labels correct')
