import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PROFILE_BIO_MIN_LENGTH, profileCompletionIssues } from '../src/data/profileRules.ts'

const completeProfile = {
  phone: '+91 98765 43210',
  city: ' Bengaluru ',
  state: 'Karnataka',
  languages: ['English'],
  skills: ['Medical sales'],
  preferredRoles: ['MR'],
  education: [{ degree: 'B.Pharm', institution: 'City College', year: '2025' }],
  bio: 'Motivated pharma graduate with strong communication skills.',
  // Freshers can apply without experience; these fields are intentionally optional.
  experience: [],
}

assert.equal(PROFILE_BIO_MIN_LENGTH, 20)
assert.deepEqual(profileCompletionIssues(completeProfile), [], 'a job-ready profile is complete without optional fields')
assert.deepEqual(profileCompletionIssues({ ...completeProfile, phone: undefined }, '09876543210'), [], 'a valid account phone can fill the contact requirement')
assert.deepEqual(profileCompletionIssues({ ...completeProfile, phone: '58765 43210' }).includes('a valid phone number'), true)

const emptyIssues = profileCompletionIssues({})
assert.deepEqual(emptyIssues, [
  'a valid phone number',
  'your city',
  'your state',
  'at least one language',
  'at least one skill',
  'at least one preferred role',
  'one education entry with degree, institution, and pass-out year',
  `a short profile summary (at least ${PROFILE_BIO_MIN_LENGTH} characters)`,
])

assert.ok(profileCompletionIssues({
  ...completeProfile,
  languages: ['  '],
  skills: [],
  preferredRoles: [''],
  education: [{ degree: 'B.Pharm', institution: ' ', year: '2025' }],
  bio: 'too short',
}).length > 0, 'whitespace-only entries and incomplete education are not accepted')

assert.deepEqual(profileCompletionIssues({
  ...completeProfile,
  bio: 'x'.repeat(PROFILE_BIO_MIN_LENGTH),
}), [], 'the minimum-length bio is accepted')

const editor = await readFile(new URL('../src/components/ProfileEditor.tsx', import.meta.url), 'utf8')
const account = await readFile(new URL('../src/screens/AccountScreen.tsx', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
assert.match(editor, /EditLabel label="Subject"/, 'education calls the field Subject')
assert.match(editor, /EditLabel label="Pass-out year"/, 'education labels the completion year clearly')
assert.match(editor, /<Select[\s\S]*id="profile-city"[\s\S]*INDIAN_CITY_SUGGESTIONS\.map/, 'city is selected from a dropdown with a custom-town option')
assert.match(editor, /<Select[\s\S]*id="profile-state"[\s\S]*INDIAN_STATES_AND_UTS\.map/, 'state is selected from Indian states and union territories')
assert.match(editor, /setLanguagesText\(e\.target\.value\); update\(\{ languages: split\(e\.target\.value\) \}\)/, 'language input preserves a trailing comma while typing')
assert.match(editor, /setSkillsText\(e\.target\.value\); update\(\{ skills: split\(e\.target\.value\) \}\)/, 'skills input preserves a trailing comma while typing')
assert.match(editor, /setRolesText\(e\.target\.value\); update\(\{ preferredRoles: split\(e\.target\.value\) \}\)/, 'preferred-role input preserves a trailing comma while typing')
assert.match(editor, /readOnly && \([\s\S]{0,300}aria-label="Edit profile"/, 'saved profile has an explicit pencil edit action')
assert.match(editor, /<fieldset disabled=\{readOnly\}/, 'profile fields cannot be changed before entering edit mode')
assert.match(account, /readOnly=\{!profileEditing\}/, 'the account starts completed profiles in read-only mode')
assert.match(account, /disabled=\{!profileEditing\}/, 'saving is disabled until the user taps Edit profile')
assert.match(app, /setSelectedJob\(job\)[\s\S]*Profile saved — back to the job[\s\S]*'success'/, 'a completed profile returns to the job with a green success toast')

console.log('profile rules: required job-ready details, phone formats, education, bio, and fresher path passed')
