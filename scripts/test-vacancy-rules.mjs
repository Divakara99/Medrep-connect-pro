import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  actorLabel,
  deleteReasonProblem,
  headquartersProblem,
  isPharmaSalesCategory,
  requiredHeadquartersProblem,
  normalizeIndianMobile,
  parseHeadquarters,
  serializeHeadquarters,
  paymentStatusLabel,
  paymentStatusTone,
  paymentTotals,
  paymentTypeLabel,
  summarizeActivity,
} from '../src/data/vacancyRules.ts'

/**
 * Pure rules behind the vacancy team and payments screens:
 *   - a delete reason must be 5 to 300 characters
 *   - activity totals split admin and team work, and count reasons
 *   - every payment gets one plain type label and one plain status label
 */

assert.match(deleteReasonProblem('') ?? '', /at least 5/)
assert.match(deleteReasonProblem('    ab  ') ?? '', /at least 5/)
assert.equal(deleteReasonProblem('Position filled'), null)
assert.match(deleteReasonProblem('x'.repeat(301)) ?? '', /under 300/)

assert.deepEqual(parseHeadquarters('Hyderabad HO'), ['Hyderabad HO'], 'existing single-string HQs remain supported')
assert.deepEqual(parseHeadquarters('Hyderabad HO\r\nBengaluru HQ'), ['Hyderabad HO', 'Bengaluru HQ'])
assert.equal(serializeHeadquarters([' Hyderabad HO ', '', ' Bengaluru HQ ']), 'Hyderabad HO\nBengaluru HQ')
assert.equal(headquartersProblem(['x'.repeat(119)]), null)
assert.match(headquartersProblem(['x'.repeat(120), 'y']) ?? '', /within 120 characters/)
assert.equal(isPharmaSalesCategory('MR'), true)
assert.equal(isPharmaSalesCategory('ABM'), true)
assert.equal(isPharmaSalesCategory('Finance'), false)
assert.match(requiredHeadquartersProblem('MR', ['']) ?? '', /at least one HQ/)
assert.match(requiredHeadquartersProblem('ABM', ['  ']) ?? '', /at least one HQ/)
assert.equal(requiredHeadquartersProblem('MR', ['Hyderabad HO']), null)
assert.equal(requiredHeadquartersProblem('Finance', ['']), null, 'HQ is not required for non-pharma roles')
assert.equal(normalizeIndianMobile('+91 90352 80940'), '9035280940')
assert.equal(normalizeIndianMobile('09066411078'), '9066411078')
assert.equal(normalizeIndianMobile('9066411078'), '9066411078')

const row = (overrides) => ({
  id: 1,
  action: 'added',
  vacancyId: 'v',
  title: 'Role',
  company: 'Co',
  location: 'Pune',
  category: 'MR',
  actorRole: 'admin',
  actorEmail: 'admin@example.org',
  reason: null,
  createdAt: 0,
  ...overrides,
})

assert.equal(actorLabel(row({ actorRole: 'admin' })), 'Admin')
assert.equal(actorLabel(row({ actorRole: 'vacancy_editor', actorEmail: 'team@example.org' })), 'team@example.org')
assert.equal(actorLabel(row({ actorRole: 'earlier' })), 'Before tracking')

const summary = summarizeActivity([
  row({ id: 1, actorRole: 'earlier', actorEmail: '' }),
  row({ id: 2, actorRole: 'earlier', actorEmail: '' }),
  row({ id: 3, actorRole: 'vacancy_editor', actorEmail: 'team@example.org' }),
  row({ id: 4, action: 'deleted', actorRole: 'vacancy_editor', actorEmail: 'team@example.org', reason: 'Position filled' }),
  row({ id: 5, action: 'deleted', actorRole: 'admin', reason: 'Position filled' }),
  row({ id: 6, action: 'deleted', actorRole: 'admin', reason: 'Duplicate entry' }),
  row({ id: 7, action: 'deleted', actorRole: 'earlier', actorEmail: '', reason: 'Deleted before activity tracking began' }),
])
assert.equal(summary.added, 3)
assert.equal(summary.deleted, 4)
assert.equal(summary.addedByTeam, 1)
assert.equal(summary.deletedByTeam, 1)
assert.deepEqual(summary.reasons[0], { reason: 'Position filled', count: 2 }, 'most frequent reason comes first')
assert.equal(summary.reasons.length, 3)
const team = summary.byActor.find((actor) => actor.label === 'team@example.org')
assert.deepEqual([team.added, team.deleted], [1, 1])

assert.equal(
  summarizeActivity([row({ action: 'deleted', reason: '  ' })]).reasons[0].reason,
  'No reason recorded',
  'a blank stored reason is shown as missing, not as an empty label',
)

assert.equal(paymentTypeLabel('Razorpay'), 'Online (Razorpay)')
assert.equal(paymentTypeLabel('UPI'), 'UPI transfer (bank check)')
assert.equal(paymentTypeLabel('Manual grant'), 'Free grant by admin')
assert.equal(paymentTypeLabel(undefined), 'Unknown type')

assert.equal(paymentStatusLabel({ status: 'success' }), 'Paid')
assert.equal(paymentStatusLabel({ status: 'pending' }), 'Pending')
assert.equal(paymentStatusLabel({ status: 'failed' }), 'Failed')
assert.equal(paymentStatusLabel({ status: 'rejected' }), 'Rejected')
assert.equal(paymentStatusLabel({ status: 'pending', manualReview: true, paymentMethod: 'UPI' }), 'Waiting bank check')
assert.equal(paymentStatusTone({ status: 'success' }), 'green')
assert.equal(paymentStatusTone({ status: 'failed' }), 'red')
assert.equal(paymentStatusTone({ status: 'pending', manualReview: true }), 'amber')

const totals = paymentTotals([
  { status: 'success', amount: 149 },
  { status: 'success', amount: 299 },
  { status: 'pending', amount: 99 },
  { status: 'failed', amount: 99 },
  { status: 'rejected', amount: 99 },
  { status: 'pending', amount: 499, manualReview: true },
])
assert.deepEqual(totals, { paidCount: 2, paidAmount: 448, pendingCount: 1, waitingBankCheck: 1, failedCount: 2 })

const [form, card, detail] = await Promise.all([
  readFile(new URL('../src/components/VacancyForm.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/JobCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/JobDetail.tsx', import.meta.url), 'utf8'),
])
assert.match(form, /pharmaFields && \([\s\S]*HQ \(required for MR\/ABM\)/, 'the form only shows the HQ field for MR/ABM and marks it required')
assert.match(form, /requiredHeadquartersProblem\(category, hqEntries\)/, 'the form validates an HQ for pharma-sales roles')
assert.match(form, /hq: pharmaFields \? serializeHeadquarters\(hqEntries\) : ''/, 'switching to other categories clears pharma-only HQ data on save')
assert.match(card, /isPharmaSalesCategory\(job\.category\)[\s\S]*HQ \{hqEntries\.join\(', '\)\}/, 'the list card shows HQ only for MR/ABM')
assert.match(detail, /isPharmaSalesCategory\(job\.category\)[\s\S]*hqItems\.map\(\(hq, index\) => \(\{[\s\S]*`HQ \$\{index \+ 1\}`/, 'multiple HQs receive individual HQ 1, HQ 2 labels in the detail view')
assert.match(detail, /isPharmaSalesCategory\(job\.category\)[\s\S]*label: 'Division'/, 'the detail view shows pharma-only division fields')
assert.match(detail, /\.filter\(\(field\) => field\.value\.trim\(\)\)/, 'empty optional detail fields are omitted instead of shown as dashes')

console.log('vacancy rules: role-specific HQ requirements, details, delete reasons and payment totals passed')
