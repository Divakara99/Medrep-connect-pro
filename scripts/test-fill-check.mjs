import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  FILL_CHECK_LABELS,
  fillCheckState,
  fillCheckWaiting,
  fillCheckWhatsAppText,
  fillCheckWhatsAppUrl,
  parseFillCheck,
} from '../src/data/fillCheck.ts'

/**
 * "Is this vacancy still open?"
 *
 *   * The administrator asks the hiring manager on WhatsApp — nothing stored.
 *   * The administrator can also ask the vacancy team; the question lives in
 *     the vacancy, the team answers Open or Filled, and the list shows it.
 *   * Only the answering side can set an answer, and only once asked.
 */

// 1. The states ---------------------------------------------------------------
assert.equal(fillCheckState(undefined), 'none', 'a vacancy nobody asked about')
assert.equal(fillCheckState({}), 'none', 'an empty record is the same as nothing')
assert.equal(fillCheckState({ askedAt: 1_700_000_000_000 }), 'asked', 'a question is waiting')
assert.equal(fillCheckWaiting({ askedAt: 1_700_000_000_000 }), true, 'asked means waiting')
assert.equal(fillCheckState({ askedAt: 1, answer: 'open' }), 'open')
assert.equal(fillCheckState({ askedAt: 1, answer: 'filled' }), 'filled')
assert.equal(fillCheckWaiting({ askedAt: 1, answer: 'filled' }), false, 'an answered question is not pending')
assert.equal(fillCheckWaiting({ askedAt: 1, answer: 'open' }), false)

assert.deepEqual(
  Object.values(FILL_CHECK_LABELS),
  ['Not asked', 'Waiting for reply', 'Team says: still open', 'Team says: filled'],
  'every state has one short label',
)

// 2. Reading stored data ------------------------------------------------------
assert.equal(parseFillCheck(null), undefined, 'nothing stored')
assert.equal(parseFillCheck('asked'), undefined, 'a string is not a record')
assert.equal(parseFillCheck({}), undefined, 'an empty record is dropped')
assert.deepEqual(
  parseFillCheck({ askedAt: 1_700_000_000_000, askedBy: 'admin@medrepconnect.in' }),
  {
    askedAt: 1_700_000_000_000,
    askedBy: 'admin@medrepconnect.in',
    answer: undefined,
    answeredAt: undefined,
    answeredBy: undefined,
  },
  'the question survives a round trip',
)
assert.deepEqual(
  parseFillCheck({ askedAt: 1, answer: 'filled', answeredAt: 2, answeredBy: 'team@medrepconnect.in' }),
  { askedAt: 1, askedBy: undefined, answer: 'filled', answeredAt: 2, answeredBy: 'team@medrepconnect.in' },
  'the answer survives a round trip',
)
assert.equal(parseFillCheck({ askedAt: 1, answer: 'maybe' }).answer, undefined, 'an unknown answer is ignored')
assert.equal(parseFillCheck({ askedAt: '1' }), undefined, 'a timestamp must be a number')

// 3. The WhatsApp question ----------------------------------------------------
const job = { title: 'Medical Representative', company: 'Sun Pharma', location: 'Hubballi', manager: 'Mr. Rao', contact: '98765 43210' }
const text = fillCheckWhatsAppText(job)
assert.match(text, /^Hello Mr\. Rao, is the Medical Representative at Sun Pharma, Hubballi vacancy still open\?/, 'the message names the vacancy')
assert.match(text, /YES \(still open\) or NO \(filled\)/, 'the reply is one word')
assert.match(text, /MedRep Connect Pro$/, 'the message is signed')
assert.doesNotMatch(text, /@/, 'no email address leaves the app')

assert.equal(
  fillCheckWhatsAppUrl(job),
  `https://wa.me/919876543210?text=${encodeURIComponent(text)}`,
  'a manager mobile opens the chat directly',
)
for (const contact of ['+91 98765 43210', '09876543210', '0091 9876543210']) {
  assert.equal(
    fillCheckWhatsAppUrl({ ...job, contact }),
    `https://wa.me/919876543210?text=${encodeURIComponent(text)}`,
    `${contact} normalises to the same number`,
  )
}
for (const contact of ['', '022 2345 6789', '12345', '9876543210'.slice(1)]) {
  assert.equal(
    fillCheckWhatsAppUrl({ ...job, contact }),
    `https://wa.me/?text=${encodeURIComponent(text)}`,
    `"${contact}" is not a mobile, so the app asks which chat to use`,
  )
}
assert.equal(
  fillCheckWhatsAppUrl({ title: 'MR', location: 'Pune' }),
  `https://wa.me/?text=${encodeURIComponent(fillCheckWhatsAppText({ title: 'MR', location: 'Pune' }))}`,
  'a vacancy without company or manager still writes a sentence',
)
assert.equal(fillCheckWhatsAppText({ title: 'MR', location: 'Pune' }).startsWith('Hello, is the MR, Pune vacancy'), true, 'the greeting stays valid')

// 4. The stored request -------------------------------------------------------
const jobs = await readFile(new URL('../src/data/jobs.ts', import.meta.url), 'utf8')
const askStart = jobs.indexOf('export async function setFillCheck')
const askEnd = jobs.indexOf('export async function', askStart + 1)
assert.ok(askStart > 0, 'the administrator asks through one function')
const askBlock = jobs.slice(askStart, askEnd)
assert.match(askBlock, /data:/, 'the question is written into the vacancy data')
assert.match(askBlock, /merged\.fillCheck/, 'under the fillCheck key')
assert.doesNotMatch(askBlock, /answer:\s*'(open|filled)'/, 'asking never invents an answer')

const team = await readFile(new URL('../src/data/vacancyTeam.ts', import.meta.url), 'utf8')
assert.match(team, /employee_answer_fill_check/, 'the team answers through the database function')
assert.match(team, /export async function teamAnswerFillCheck/, 'through one function')

const sql = await readFile(new URL('../supabase/vacancy_fill_check.sql', import.meta.url), 'utf8')
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.employee_list_vacancies\(\)/, 'the team list is redefined')
assert.match(sql, /'fillCheck', v\.data -> 'fillCheck'/, 'and it carries the question')
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.employee_answer_fill_check\(p_id text, p_answer text\)/, 'the answer function exists')
assert.match(sql, /answer_text NOT IN \('open', 'filled'\)/, 'only two answers are accepted')
assert.match(sql, /asked IS NULL OR coalesce\(asked ->> 'askedAt', ''\) = ''/, 'nothing is answered before it is asked')
assert.match(sql, /'answeredAt', now_ms/, 'the server stamps the time')
assert.match(sql, /'answeredBy', caller_email/, 'the server stamps who answered')
assert.match(sql, /FOR UPDATE/, 'two answers cannot race')
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.employee_answer_fill_check\(text, text\) TO authenticated/, 'the team can call it')
assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO anon;/, 'the public cannot')

const portal = await readFile(new URL('../src/screens/VacancyPortal.tsx', import.meta.url), 'utf8')
assert.match(portal, /fillCheckWaiting/, 'the portal lists the questions it must answer')
assert.match(portal, /Still open/, 'with an answer for open')
assert.match(portal, /Filled/, 'and an answer for filled')
assert.match(portal, /teamAnswerFillCheck/, 'wired to the function')

const admin = await readFile(new URL('../src/screens/AdminScreen.tsx', import.meta.url), 'utf8')
assert.match(admin, /fillCheckWhatsAppUrl/, 'the vacancies tab asks the manager on WhatsApp')
assert.match(admin, /FillCheckState|fillCheckState/, 'and reads the team answer')
assert.match(admin, /visibleJobs/, 'the list is filtered')

console.log('fill check: ok')
