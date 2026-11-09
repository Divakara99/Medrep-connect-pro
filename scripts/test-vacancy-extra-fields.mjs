import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { cleanExtraFields, extraFieldProblem } from '../src/data/extraFields.ts'
import { extractExtraFields } from '../src/data/vacancyExtraction.ts'

/**
 * Extra vacancy details.
 *
 *   * A pasted vacancy can carry lines the fixed form has no field for —
 *     "Joining: Immediate", "Two-wheeler: Required" — and they become fields of
 *     their own instead of being dropped.
 *   * Every value in the review can be edited before it is filled.
 *   * They are public, so a phone number or an email address is refused.
 */

// 1. The rules ---------------------------------------------------------------
assert.equal(extraFieldProblem('Territory', 'Hubballi North'), null, 'a plain field is accepted')
assert.match(extraFieldProblem('', 'x') ?? '', /name/, 'a field needs a name')
assert.match(extraFieldProblem('Territory', '') ?? '', /value/, 'a field needs a value')
assert.match(extraFieldProblem('Phone', '9876543210') ?? '', /phone number/, 'a phone number is refused')
assert.match(extraFieldProblem('Mail', 'hr@example.com') ?? '', /email/, 'an email address is refused')
assert.match(extraFieldProblem('x'.repeat(41), 'y') ?? '', /under 40/, 'the name is capped')
assert.match(extraFieldProblem('x', 'y'.repeat(201)) ?? '', /under 200/, 'the value is capped')

assert.deepEqual(
  cleanExtraFields([
    { label: ' Territory ', value: ' Hubballi North ' },
    { label: 'territory', value: 'duplicate label' },
    { label: 'Bad', value: 'call 9876543210' },
    { label: 'Joining', value: 'Immediate' },
  ]),
  [{ label: 'Territory', value: 'Hubballi North' }, { label: 'Joining', value: 'Immediate' }],
  'duplicates and unsafe values are dropped, the rest keep their order',
)
assert.equal(cleanExtraFields(Array.from({ length: 20 }, (_, index) => ({ label: `F${index}`, value: 'v' }))).length, 12,
  'at most twelve fields')

// 2. Reading a pasted vacancy ------------------------------------------------
const pasted = [
  'URGENTLY REQUIRED MEDICAL REPRESENTATIVE (MR)',
  'Company: Ajanta Pharma Ltd',
  'Location: Hubballi',
  'Division: Cardio',
  'Territory: Hubballi North',
  'Joining: Immediate',
  'Two-wheeler: Required',
  'Contact: 9876543210',
  'Send your resume to hr@ajanta.com',
].join('\n')

const extras = extractExtraFields(pasted)
const labels = extras.map((field) => field.label)
assert.ok(labels.includes('Joining'), 'a new label becomes an extra field')
assert.ok(labels.includes('Two-wheeler'), 'so does a second one')
assert.ok(!labels.some((label) => /contact|email|mobile|company|location|division|territory/i.test(label)),
  'fields the fixed form already owns are not duplicated as extras')
assert.ok(extras.every((field) => !/\d{6,}|@/.test(field.value)), 'contact details never reach a public field')

// 3. The review fills only what is ticked, and the values are editable --------
const form = await readFile(new URL('../src/components/VacancyForm.tsx', import.meta.url), 'utf8')
assert.match(form, /const \[extraFields, setExtraFields\] = useState<ExtraField\[\]>/, 'the form holds its extra fields')
assert.match(form, /const \[review, setReview\] = useState<\{[\s\S]{0,300}extras: ReviewExtra\[\]/, 'the review carries them')
assert.match(form, /aria-label=\{`\$\{label\} found in the pasted text`\}/, 'every extracted value is an input')
assert.match(form, /fields: \{ \.\.\.current\.fields, \[key\]: event\.target\.value \}/, 'and editing it is stored')
assert.match(form, /Extra details — new fields for this vacancy/, 'the review names them')
assert.match(form, /Fill selected values/, 'nothing is written until that button')
assert.match(form, /If the ticked extra fields are applied|const chosenExtras = review\.extras\s*\n?\s*\.filter\(\(extra\) => extra\.checked\)/,
  'only ticked extras are added')
assert.match(form, /Extra details<\/div>/, 'the form has an Extra details section')
assert.match(form, /＋ Add field/, 'a field can be added by hand')
assert.match(form, /cleanExtraFields\(extraFields\)/, 'only clean fields are saved')
assert.match(form, /extraFields: cleanExtraFields\(extraFields\)/, 'they are saved with the vacancy')

// 4. The vacancy shows them, publicly ---------------------------------------
const detail = await readFile(new URL('../src/components/JobDetail.tsx', import.meta.url), 'utf8')
assert.match(detail, /job\.extraFields/, 'the vacancy page reads them')
assert.match(detail, /More details/, 'under a public heading')
assert.match(detail, /<Badge color="slate">Public<\/Badge>/, 'and says they are public')

// 5. The server sends them ---------------------------------------------------
const sql = await readFile(new URL('../supabase/vacancy_extra_fields.sql', import.meta.url), 'utf8')
assert.match(sql, /'extraFields', CASE/, 'the projection includes them')
assert.match(sql, /jsonb_typeof\(v\.data -> 'extraFields'\) = 'array'/, 'only a real array is sent')
assert.match(sql, /WHEN can_view_private THEN/, 'the contact block is still gated')
const copy = await readFile(new URL('../scripts/copy-sql.mjs', import.meta.url), 'utf8')
assert.match(copy, /supabase\/vacancy_extra_fields\.sql/, 'the SQL is in the deployment list')

console.log('vacancy extra fields: pasted lines become editable public fields, and contact details are refused — passed')
