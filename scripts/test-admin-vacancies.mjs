import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { duplicateRemovalIds, groupDuplicateVacancies } from '../src/data/vacancyDuplicateGroups.ts'

/**
 * Admin vacancy list: one back step, one deleted row, no auto-created columns,
 * and duplicates that are previewed before anything is removed.
 */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------- duplicates
const base = {
  title: 'Medical Representative',
  company: 'Meyer Organics Pvt Ltd',
  location: 'Bengaluru',
  category: 'MR',
  contact: '9052053050',
  manager: 'Dharaneesh B',
  hq: 'BENGALURU',
  description: 'Field sales\nDoctor calls',
  pinned: false,
  postedAt: 1_000,
}

const rows = [
  { ...base, id: 'a', postedAt: 3_000 },
  { ...base, id: 'b', postedAt: 1_000 },
  { ...base, id: 'c', postedAt: 2_000, title: '  medical   representative ' },
  // A genuinely different opening: same role and company, different city.
  { ...base, id: 'd', location: 'Hyderabad' },
]

const groups = groupDuplicateVacancies(rows)
assert.equal(groups.length, 1, 'only the three identical posts form a group')
assert.deepEqual(groups[0].remove.map((job) => job.id).sort(), ['a', 'c'], 'the oldest post is kept, the rest are removed')
assert.equal(groups[0].keep.id, 'b')
assert.deepEqual(duplicateRemovalIds(groups).sort(), ['a', 'c'])

// A pinned copy wins over the oldest, so pinning protects a listing.
const pinned = groupDuplicateVacancies([
  { ...base, id: 'old', postedAt: 1_000 },
  { ...base, id: 'pinned', postedAt: 5_000, pinned: true },
])
assert.equal(pinned[0].keep.id, 'pinned')
assert.deepEqual(pinned[0].remove.map((job) => job.id), ['old'])

// No duplicates -> nothing to preview and nothing to delete.
assert.deepEqual(groupDuplicateVacancies([{ ...base, id: 'a' }]), [])
assert.deepEqual(groupDuplicateVacancies([]), [])

// ------------------------------------------------------------ one row delete
const jobs = await read('src/data/jobs.ts')
const deleteJob = jobs.slice(jobs.indexOf('export async function deleteJob'))
const deleteBody = deleteJob.slice(0, deleteJob.indexOf('\n}\n') + 3)

assert.match(deleteBody, /\.eq\('id', id\)/, 'the delete is scoped to the clicked primary key')
assert.doesNotMatch(deleteBody, /\.single\(\)/, 'a delete must not rely on single(), which throws whenever nothing matched')
assert.match(deleteBody, /\.select\('id'\)/, 'the delete asks the database which row changed')
assert.match(deleteBody, /changed !== 1/, 'exactly one changed row is required before the list is updated')
assert.match(deleteBody, /const previous = jobs\.find/, 'only a vacancy the admin can see can be deleted')
assert.match(deleteBody, /\.\.\.previous/, 'the tombstone keeps the rest of the row instead of blanking it')
assert.match(deleteBody, /jobs = jobs\.filter\(\(job\) => job\.id !== id\)/, 'only that one row leaves the local list')

// ------------------------------------------------------------- back navigation
const admin = await read('src/screens/AdminScreen.tsx')
assert.match(admin, /const stepBack = useCallback\(\(\) => \{/, 'the admin panel has one back step')
assert.match(admin, /if \(tab !== 'dashboard'\) \{\s*setTab\('dashboard'\)/, 'back from a section returns to the dashboard')
assert.match(admin, /useBackHandler\(true, stepBack\)/, 'the phone back button follows the same steps')
assert.match(admin, /<BackButton\s*onClick=\{stepBack\}/, 'the header arrow uses the same steps — never a straight sign-out')
assert.doesNotMatch(admin, /BackButton onClick=\{\(\) => setExitOpen\(true\)\}/, 'no arrow signs the admin out directly')
assert.match(admin, /label=\{tab === 'dashboard' \? 'Leave the admin panel' : 'Back to the dashboard'\}/, 'the arrow says where it goes')

// One delete = one vacancy, and the admin is told exactly what happened.
assert.match(admin, /This deletes this one vacancy only\. The other \{Math\.max\(jobs\.length - 1, 0\)\} vacancies stay published\./)
assert.match(admin, /Deleted 1 vacancy — “\$\{target\.title\}”\. The other \$\{Math\.max\(jobs\.length - 1, 0\)\} vacancies are unchanged\./)

// Duplicates: preview + confirmation, one row at a time.
assert.match(admin, /Remove duplicates \(\{duplicateIds\.length\}\)/, 'the list offers a duplicate clean-up')
assert.match(admin, /Nothing is removed until you press the button below\./, 'the duplicate sheet is a preview, not a silent sweep')
assert.match(admin, /text-\[10px\] font-bold uppercase tracking-wider text-emerald-700">Keep</, 'the preview names the copy that is kept')
assert.match(admin, /for \(const id of ids\) \{\s*await deleteJob\(id, duplicateReason\)/, 'duplicates are deleted one row at a time')
assert.match(admin, /deleteReasonProblem\(duplicateReason\)/, 'duplicate removal carries the same audited reason')

// ------------------------------------------------------- pasted text is opt-in
const form = await read('src/components/VacancyForm.tsx')
assert.doesNotMatch(form, /applyExtractedFields\((?:extracted|fields)\)(?!\s*\))/, 'reading text must not fill the form by itself')
assert.match(form, /setReview\(\{ fields: extracted, picked \}\)/, 'the reader only lists what it found')
assert.match(form, /for \(const \{ key \} of found\) picked\[key\] = !draftValue\(key\)\.trim\(\)/, 'fields the admin already typed start unticked')
assert.match(form, /function applyReviewedFields\(\)/, 'only ticked values are written')
assert.match(form, /const next = current\.length > 0 \? \[\.\.\.current\] : \[''\]/, 'HQ text never adds a new HQ box')
assert.match(form, /if \(!next\[0\]\.trim\(\) && hqText\) next\[0\] = hqText/, 'HQ text fills the first box only')
assert.doesNotMatch(form, /if \(fields\.hq\?\.trim\(\)\) \{\s*const entries = parseHeadquarters/, 'the old HQ box-spawning path is gone')

console.log('admin vacancies: back steps to the dashboard, one delete removes one row, pasted text is opt-in, duplicates are previewed — passed')
