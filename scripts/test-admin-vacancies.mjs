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

// ------------------------------------------------------------------- undo
const restoreStart = jobs.indexOf('export async function restoreJob')
assert.ok(restoreStart > 0, 'a delete can be undone from the database')
const restoreBody = jobs.slice(restoreStart, jobs.indexOf('\n}', restoreStart) + 2)
assert.match(restoreBody, /\.eq\('id', id\)\.select\('id'\)/, 'a restore touches exactly one primary key')
assert.match(restoreBody, /delete restored\.deleted/, 'the tombstone flag is what gets cleared')
assert.match(restoreBody, /changed !== 1/, 'a restore is verified like a delete')
assert.match(restoreBody, /before its details were kept, so it cannot be restored/, 'old empty tombstones are refused instead of restoring a blank card')
assert.match(jobs, /export async function loadDeletedVacancies/, 'the bin can be listed')

// ------------------------------------------------------------- back navigation
const admin = await read('src/screens/AdminScreen.tsx')
const dashboardStart = admin.indexOf('function DashboardTab(')
const dashboardEnd = admin.indexOf('function SupabaseSyncStatus()', dashboardStart)
const dashboard = admin.slice(dashboardStart, dashboardEnd)
const recentPayments = dashboard.slice(dashboard.indexOf('Recent payments'))
assert.doesNotMatch(dashboard, /Current Heavy|layoutMode|setLayoutMode/, 'the expanded layout toggle is removed')
assert.match(dashboard, /grid grid-cols-2 gap-2\.5/, 'compact metrics use the tight two-column mobile grid')
assert.match(dashboard, /compactLabel="ACTIVE SUBS"/, 'long metric labels are shortened in compact mode')
assert.match(recentPayments, /space-y-1\.5/, 'recent payments use a compact stack of single-line boxes')
assert.match(recentPayments, /className="flex min-w-0 items-center gap-2 rounded-lg border/, 'each recent transaction is a one-line box')
assert.match(recentPayments, /All payments →/, 'the recent-payments panel has a compact all-payments button')
assert.match(recentPayments, /onClick=\{\(\) => onNavigate\('payments'\)\}[\s\S]*Open →/, 'each payment box has a compact action button')
assert.doesNotMatch(recentPayments, /<table/, 'recent payments do not overflow as a table on phones')
assert.match(admin, /const stepBack = useCallback\(\(\) => \{/, 'the admin panel has one back step')
assert.match(admin, /if \(tab !== 'dashboard'\) \{\s*setTab\('dashboard'\)/, 'back from a section returns to the dashboard')
assert.match(admin, /useBackHandler\(true, stepBack\)/, 'the phone back button follows the same steps')
assert.match(admin, /\{tab !== 'dashboard' && \(\s*<button[\s\S]*?onClick=\{stepBack\}[\s\S]*?aria-label="Back to previous page"/, 'the visible back button is hidden on the dashboard and shown on other admin pages')
assert.match(admin, /useBackHandler\(true, stepBack\)/, 'the phone back button remains available on every admin page')
assert.ok(admin.includes('setTabHistory((history) => [...history, tab])'), 'admin navigation remembers the previous page')
assert.match(admin, /const previous = tabHistory\[tabHistory\.length - 1\][\s\S]*setTabHistory\(\(history\) => history\.slice\(0, -1\)\)/, 'the back button returns through page history')
assert.doesNotMatch(admin, /<div className="min-h-\[100dvh\] bg-slate-50" key=\{version\}>/, 'data refreshes must not remount and reset the entire admin interface')
assert.match(admin, /<Wordmark size="text-sm" \/>/, 'the compact admin header retains the app name')
const paymentsStart = admin.indexOf('function PaymentsTab(')
const paymentsEnd = admin.indexOf('\nfunction ', paymentsStart + 1)
const paymentsTab = admin.slice(paymentsStart, paymentsEnd)
assert.ok(paymentsStart >= 0 && paymentsEnd > paymentsStart, 'the payments page is available for layout checks')
assert.doesNotMatch(paymentsTab, /<table|overflow-x-auto/, 'all payments no longer uses a wide table')
assert.match(paymentsTab, /space-y-1\.5[\s\S]*?shown\.map\(\(payment\)/, 'all payments uses a compact stack of transaction boxes')
assert.match(paymentsTab, /className="flex min-w-0 items-center gap-1\.5 rounded-lg border/, 'each all-payments transaction is a single-line box')
assert.match(paymentsTab, /aria-label=\{`Payment details for \$\{customer\}`\}/, 'payment details remain available in each row')
assert.match(paymentsTab, /setDecision\(\{ payment, approve: false \}\)[\s\S]*setDecision\(\{ payment, approve: true \}\)/, 'manual payments retain reject and verify actions')

// The list itself is server-backed, so an emptied cache cannot look like a
// deleted catalogue.
assert.match(admin, /const \[jobs, setJobs\] = useState<Job\[\]>\(\(\) => sortedJobs\(getJobs\(\)\)\)/, 'the tab keeps its own list')
assert.match(admin, /void loadAdminJobs\(\)/, 'the tab re-reads the catalogue when it opens')
assert.match(admin, /async function reload\(\): Promise<Job\[\]> \{\s*const list = sortedJobs\(await loadAdminJobs\(\)\)/, 'every change re-reads the catalogue from the server')
assert.match(admin, /await deleteJob\(target\.id, reason\)/, 'the single delete still targets one primary key')

// One delete = one vacancy, and the admin is told exactly what happened.
assert.match(admin, /This deletes this one vacancy only\. The other \{Math\.max\(jobs\.length - 1, 0\)\} vacancies stay published\./)
assert.match(admin, /Deleted 1 vacancy — “\$\{target\.title\}”\. \$\{after \?\? Math\.max\(before - 1, 0\)\} vacancies remain\./, 'the banner reports exactly how many vacancies remain')
assert.match(admin, /after < before - 1/, 'a drop of more than one row is called out instead of hidden')
assert.match(admin, /Vacancy team → Deleted/, 'the warning points at the deletion log')

// Duplicates: preview + confirmation, one row at a time.
assert.match(admin, /Remove duplicates \(\{duplicateIds\.length\}\)/, 'the list offers a duplicate clean-up')
assert.match(admin, /Nothing is removed until you press the button below\./, 'the duplicate sheet is a preview, not a silent sweep')
assert.match(admin, /text-\[10px\] font-bold uppercase tracking-wider text-emerald-700">Keep</, 'the preview names the copy that is kept')
assert.match(admin, /for \(const id of ids\) \{\s*await deleteJob\(id, duplicateReason\)/, 'duplicates are deleted one row at a time')
assert.match(admin, /deleteReasonProblem\(duplicateReason\)/, 'duplicate removal carries the same audited reason')

// ------------------------------------------------------- pasted text is opt-in
const form = await read('src/components/VacancyForm.tsx')
const jpgTemplate = await readFile(new URL('../public/templates/vacancy-template.jpg', import.meta.url))
const docTemplate = await read('public/templates/vacancy-template.doc')
const imageTemplate = await read('public/templates/vacancy-template.svg')
assert.deepEqual([...jpgTemplate.subarray(0, 3)], [0xff, 0xd8, 0xff], 'the image template is an actual JPEG file')
assert.match(form, /templates\/vacancy-template\.jpg/, 'vacancy upload offers a downloadable JPG template')
assert.match(form, /templates\/vacancy-template\.doc/, 'vacancy upload offers a downloadable Word template')
for (const template of [docTemplate, imageTemplate]) {
  assert.match(template, />Data</, 'the template has a Data column')
  assert.match(template, />Entry</, 'the template has a blank Entry column')
  assert.match(template, /Contact number/i, 'the template covers contact details')
  assert.match(template, /50 characters/i, 'each entry box allows 50 or more characters')
}
assert.match(form, /room for at least 50 characters in each Entry box/, 'admins are told the entry capacity')
assert.match(form, /Fill the JPG directly or complete the Word document/, 'admins are told how to complete and upload the templates')
assert.doesNotMatch(form, /applyExtractedFields\((?:extracted|fields)\)(?!\s*\))/, 'reading text must not fill the form by itself')
assert.match(form, /setReview\(\{ fields: extracted, picked, extras \}\)/, 'the reader only lists what it found, with any extra details')
assert.match(form, /for \(const \{ key \} of found\) picked\[key\] = !draftValue\(key\)\.trim\(\)/, 'fields the admin already typed start unticked')
assert.match(form, /function applyReviewedFields\(\)/, 'only ticked values are written')
assert.match(form, /const next = current\.length > 0 \? \[\.\.\.current\] : \[''\]/, 'HQ text never adds a new HQ box')
assert.match(form, /if \(!next\[0\]\.trim\(\) && hqText\) next\[0\] = hqText/, 'HQ text fills the first box only')
assert.doesNotMatch(form, /if \(fields\.hq\?\.trim\(\)\) \{\s*const entries = parseHeadquarters/, 'the old HQ box-spawning path is gone')

// The panel offers Undo twice: in the banner right after a delete, and per row
// in the Deleted list.
assert.match(admin, /label: '↩ Undo', run: \(\) => undoDelete\(target\)/, 'the delete banner carries an Undo action')
assert.match(admin, /Deleted vacancies \(\{deleted\.length\}\)/, 'the Vacancies tab lists what was deleted')
assert.match(admin, /\{undoBusyId === item\.id \? 'Restoring…' : '↩ Restore'\}/, 'each deleted vacancy has its own Restore')
assert.match(admin, /const restoredTitle = await restoreJob\(target\.id\)/, 'Undo restores through the database helper')
assert.match(admin, /action\?: \{ label: string; run: \(\) => void \}/, 'the notice can carry one action')

// ------------------------------------------------- the list reads as a table
assert.match(admin, />\s*Vacancy\s*<\/span>\s*<span>City<\/span>\s*<span>Category<\/span>\s*<span>Posted<\/span>/, 'the vacancy list has column headings')
assert.match(admin, /sm:grid-cols-\[minmax\(0,2\.2fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,0\.8fr\)_auto\]/, 'each row uses the same column tracks as the heading')
assert.match(admin, /function postedOn\(ms: number\): string/, 'the Posted column has one shared date format')
assert.doesNotMatch(admin, /w-10 h-10 rounded-lg bg-brand-100/, 'the stacked avatar card is gone')

console.log('admin vacancies: single compact dashboard and page-history back buttons, payment boxes, one-row delete/undo, opt-in text review, duplicates previewed, image template — passed')
