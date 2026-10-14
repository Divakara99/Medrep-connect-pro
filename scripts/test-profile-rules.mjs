import assert from 'node:assert/strict'
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
  'one education entry with degree, institution, and year',
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

console.log('profile rules: required job-ready details, phone formats, education, bio, and fresher path passed')
