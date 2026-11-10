// Sharing a vacancy: open to everyone, and it never carries contact details.
//
// A free user can pass a job to a friend — that is promotion, not a paywall
// bypass. The message is built only from the public fields, and the Play Store
// link is always appended so the friend can install the app.

import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const source = await readFile(new URL('../src/data/jobShareText.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: 'jobShareText.ts',
}).outputText
const file = join(process.env.TMPDIR || '/tmp', `mrc-jobshare-${process.pid}.mjs`)
await writeFile(file, javascript)
const { shareJobText, PLAY_STORE_URL, SHARE_TITLE } = await import(pathToFileURL(file).href)

const PRIVATE = {
  company: 'Sunrise Pharma Pvt Ltd',
  manager: 'Ramesh Kumar',
  managerEmail: 'ramesh.kumar@sunrisepharma.example',
  contact: '9876543210',
  managerAltPhone: '9123456780',
  companyUnlocked: true,
  jobUnlocked: true,
}

// A whole job object, as the app holds it — private fields included.
const job = {
  id: 'job_1',
  ...PRIVATE,
  title: 'Medical Representative',
  category: 'MR',
  location: 'Mumbai / Pune',
  hq: 'Mumbai HO\nPune RO',
  division: 'Cardiology',
  experience: '0–2 years',
  qualification: 'B.Pharm',
  salary: '₹3.2 LPA',
  vacancyCount: '2 positions',
  ageLimit: 'Below 30',
  description: ['(+)', '• Field work across Mumbai', '• Daily doctor visits'].join('\n'),
  postedAt: Date.UTC(2026, 10, 9),
}

const text = shareJobText(job)

// ---------- what the friend receives ----------
assert.match(text, /Role: Medical Representative/)
assert.match(text, /Category: MR/)
assert.match(text, /City: Mumbai \/ Pune/)
assert.match(text, /HQ: Mumbai HO, Pune RO/, 'each HQ line is shared, on one line')
assert.match(text, /Experience: 0–2 years/)
assert.match(text, /Salary: ₹3\.2 LPA/)
assert.match(text, /• Field work across Mumbai/, 'description bullets travel')
assert.match(text, /• Daily doctor visits/)
assert.ok(text.includes(PLAY_STORE_URL), 'the Play Store link is always included')
assert.match(text, /Company name, manager name and contact numbers are shown only inside the app\./)
assert.equal(SHARE_TITLE, 'MedRep Pro vacancy')

// ---------- what must never leave the app ----------
for (const [label, secret] of Object.entries(PRIVATE)) {
  assert.ok(
    !text.includes(String(secret)),
    `${label} leaked into the share text: ${secret}`,
  )
}
assert.ok(!/Sunrise Pharma/.test(text), 'no company name')
assert.ok(!/Ramesh Kumar/.test(text), 'no manager name')
assert.ok(!/\d{10}/.test(text), 'no phone number')
assert.ok(!/@/.test(text), 'no email address')
assert.ok(!/sunrisepharma/i.test(text), 'no employer domain')

// A subscriber sharing the very same job gets the very same text.
const subscribed = shareJobText({ ...job, companyUnlocked: true, jobUnlocked: true })
assert.equal(subscribed, text, 'paying or free, the shared message is identical')

// ---------- edges ----------
const bare = shareJobText({ title: 'Territory Manager' })
assert.ok(bare.includes(PLAY_STORE_URL))
assert.ok(!/Company name/.test(bare) === false, 'the contact note is always there')
assert.ok(!/HQ:/.test(bare), 'empty fields are omitted, not printed blank')
assert.equal(shareJobText({}), shareJobText({}), 'no fields still produces a link, not a crash')

// Long descriptions are trimmed so the message stays sendable.
const long = shareJobText({
  title: 'ABM',
  description: Array.from({ length: 30 }, (_, i) => `Point ${i + 1}`).join('\n'),
})
assert.equal((long.match(/^• /gm) || []).length, 6, 'at most six description bullets')

// ---------- the type itself refuses contact fields ----------
const typeBlock = source.slice(source.indexOf('export type ShareableVacancy'), source.indexOf('/** The share sheet'))
for (const forbidden of ['company', 'manager', 'contact', 'phone', 'email']) {
  assert.ok(!new RegExp(`\\b${forbidden}\\w*\\??:`).test(typeBlock), `ShareableVacancy must not carry ${forbidden}`)
}

// ---------- everyone can reach the button ----------
const card = await readFile(new URL('../src/components/JobCard.tsx', import.meta.url), 'utf8')
const detail = await readFile(new URL('../src/components/JobDetail.tsx', import.meta.url), 'utf8')
assert.ok(/<ShareJobButton job=\{job\}/.test(card), 'the card offers Share to every viewer')
assert.ok(/<ShareJobButton job=\{job\}/.test(detail), 'the job page offers Share to every viewer')
assert.ok(!/unlocked &&[\s\S]{0,80}<ShareJobButton/.test(card), 'Share is not gated behind the subscription')
assert.ok(/border-t border-\[#eef1f8\] px-4 py-3">[\s\S]{0,900}?<ShareJobButton job=\{job\} icon/.test(card), 'the card share rides in the footer strip, costing no extra card block')
assert.ok(!/displays the share row/.test(card) && !/justify-end">\s*\{showUnlockButton/.test(card), 'no extra action row is added to the card')
assert.ok(/<ShareJobButton job=\{job\} \/>/.test(detail), 'the job page keeps the full labelled button')

// ---------- the web control is a link, the app uses the chooser ----------
const button = await readFile(new URL('../src/components/ShareJobButton.tsx', import.meta.url), 'utf8')
assert.ok(/href=\{webHref\}/.test(button), 'on the web the control is a real link to WhatsApp')
assert.ok(/target="_blank"/.test(button), 'the link opens in a new tab, not over the app')
assert.ok(/isNativeApp\(\)/.test(button), 'the Android app still opens the system chooser')
assert.ok(!/window\.open\(/.test(button), 'the web control does not script a popup')

// ---------- native share sheet with a copy fallback ----------
const platform = await readFile(new URL('../src/data/jobShare.ts', import.meta.url), 'utf8')
assert.ok(/from '@capacitor\/share'/.test(platform), 'Android uses the system share sheet')
assert.ok(/navigator\.share/.test(platform), 'the browser uses Web Share when present')
assert.ok(!/navigator\.clipboard/.test(platform), 'the clipboard API is never called')
assert.ok(!/execCommand/.test(platform), 'there is no legacy copy path either')
assert.ok(platform.includes('wa.me/?text='), 'WhatsApp is opened directly when there is no share sheet')
assert.ok(platform.includes('sms:?&body='), 'the Messages app is the fallback for people without WhatsApp')
assert.ok(/dialogTitle: 'Share this vacancy'/.test(platform), 'Android opens the system chooser directly')
assert.ok(!/window\.location\.href\s*=/.test(platform), 'the app never navigates itself away from the page')
assert.ok(/'blocked'/.test(platform), 'a blocked popup is reported, not forced through')
assert.ok(/openExternal\(smsShareUrl/.test(platform), 'the Messages app is a real fallback')
assert.ok(/cancelled/.test(platform), 'a dismissed sheet is not treated as an error')

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.ok(pkg.dependencies['@capacitor/share'], '@capacitor/share is a shipping dependency')

console.log('share jobs: public details plus the Play Store link, contact details never, open to every user passed')
