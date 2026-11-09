// Job feed filters: City and HQ, and no salary filter.
//
// A vacancy can be open in more than one city and can carry several HQ lines,
// so a filter must match any entry rather than the whole string. City and HQ
// choices are built from the live feed; salary filtering was removed because
// most postings quote it as free text, which made the ranges guesswork.

import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const source = await readFile(new URL('../src/data/jobFilters.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: 'jobFilters.ts',
}).outputText
const file = join(process.env.TMPDIR || '/tmp', `mrc-jobfilters-${process.pid}.mjs`)
await writeFile(file, javascript)
const { cityEntries, hqEntries, cityOptions, hqOptions, matchesCity, matchesHq } =
  await import(pathToFileURL(file).href)

const jobs = [
  { location: 'Mumbai / Pune', hq: 'Mumbai HO' },
  { location: 'Bengaluru', hq: 'Hyderabad HO\nBengaluru' },
  { location: 'mumbai', hq: '  Pune  ' },
  { location: '', hq: '' },
]

// ---------- entries ----------
assert.deepEqual(cityEntries('Mumbai / Pune'), ['Mumbai', 'Pune'])
assert.deepEqual(cityEntries('Delhi, Noida|Gurugram'), ['Delhi', 'Noida', 'Gurugram'])
assert.deepEqual(cityEntries('  '), [])
assert.deepEqual(hqEntries('Hyderabad HO\nBengaluru'), ['Hyderabad HO', 'Bengaluru'])
assert.deepEqual(hqEntries(undefined), [])

// ---------- options ----------
assert.deepEqual(cityOptions(jobs), ['Bengaluru', 'Mumbai', 'Pune'], 'cities are unique and alphabetical')
assert.deepEqual(
  hqOptions(jobs),
  ['Bengaluru', 'Hyderabad HO', 'Mumbai HO', 'Pune'],
  'HQ options are unique, trimmed and alphabetical',
)
assert.deepEqual(cityOptions([]), [])
assert.deepEqual(hqOptions([]), [])

// A repeated city in a different case never shows twice.
assert.equal(cityOptions([{ location: 'Mumbai' }, { location: 'MUMBAI' }, { location: 'mumbai' }]).length, 1)

// ---------- matching ----------
assert.equal(matchesCity(jobs[0], 'Pune'), true, 'a second city in the field still matches')
assert.equal(matchesCity(jobs[0], 'Mumbai'), true)
assert.equal(matchesCity(jobs[2], 'Mumbai'), true, 'matching is case-insensitive')
assert.equal(matchesCity(jobs[1], 'Pune'), false)
assert.equal(matchesCity(jobs[1], ''), true, '"All" matches everything')

assert.equal(matchesHq(jobs[1], 'Hyderabad HO'), true, 'a second HQ line matches')
assert.equal(matchesHq(jobs[1], 'Bengaluru'), true)
assert.equal(matchesHq(jobs[2], 'Pune'), true, 'HQ entries are trimmed')
assert.equal(matchesHq(jobs[0], 'Hyderabad HO'), false)
assert.equal(matchesHq(jobs[0], ''), true)

// ---------- the screen offers City and HQ, and no salary filter ----------
const home = await readFile(new URL('../src/screens/HomeScreen.tsx', import.meta.url), 'utf8')
assert.ok(/Filter by city/.test(home), 'the sheet has a City filter')
assert.ok(/Filter by HQ/.test(home), 'the sheet has an HQ filter')
assert.ok(!/Filter by salary/.test(home), 'the salary filter is gone')
assert.ok(!/SALARY_OPTIONS/.test(home), 'no salary option list is left behind')
assert.ok(!/salary/i.test(home), 'nothing on the feed screen refers to salary filtering')
assert.ok(/cityOptions/.test(home) && /hqOptions/.test(home), 'the choices come from the live feed')
assert.ok(/M4 5h16l-6\.4 7\.5V19/.test(home), 'the filter button draws a funnel icon')
assert.ok(!/⚙️/.test(home), 'the settings gear is no longer the filter symbol')

// ---------- the data layer filters on both, and only what is asked ----------
const sourceJobs = await readFile(new URL('../src/data/jobs.ts', import.meta.url), 'utf8')
const filterStart = sourceJobs.indexOf('export function filterJobs(')
assert.ok(filterStart > 0, 'filterJobs is present')
const filterBody = sourceJobs.slice(filterStart, sourceJobs.indexOf('export function descriptionPoints'))
assert.ok(/matchesCity\(/.test(filterBody) && /matchesHq\(/.test(filterBody), 'filterJobs applies City and HQ')
assert.ok(!/salary/i.test(filterBody), 'filterJobs does not filter by salary')

console.log('job filters: City and HQ options from the live feed, multi-entry matching, no salary filter passed')
