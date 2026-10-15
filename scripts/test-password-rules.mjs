import assert from 'node:assert/strict'
import {
  MIN_STAFF_PASSWORD_LENGTH,
  MIN_USER_PASSWORD_LENGTH,
  minimumForAccount,
  passwordErrorForAccount,
  passwordLengthError,
  staffPasswordError,
  userPasswordError,
} from '../src/data/passwordRules.ts'

/**
 * Password policy (src/data/passwordRules.ts) — owner decision:
 *   - EVERY account needs at least 6 characters: job seekers, administrators
 *     and vacancy-team accounts alike (6–10 work, longer stays valid, no max).
 *   - This includes an admin / vacancy-team account that resets its password
 *     through the JOB-SEEKER page: the minimum is resolved from the account's
 *     actual role (minimumForAccount), and both roles resolve to 6, so no page
 *     can demand a different length than another.
 */
assert.equal(MIN_USER_PASSWORD_LENGTH, 6, 'job-seeker minimum is 6')
assert.equal(MIN_STAFF_PASSWORD_LENGTH, 6, 'admin and vacancy-team minimum is also 6')
assert.equal(minimumForAccount(false), 6, 'job seeker resolves to 6')
assert.equal(minimumForAccount(true), 6, 'staff on any page resolves to 6')
assert.equal(userPasswordError('12345'), 'Password must be at least 6 characters.')
assert.equal(staffPasswordError('12345'), 'Password must be at least 6 characters.')
assert.equal(passwordLengthError('1234567', 8), 'Password must be at least 8 characters.')

for (const password of ['', 'a', '12345', 'passw']) {
  assert.match(userPasswordError(password) ?? '', /at least 6 characters/)
  assert.match(staffPasswordError(password) ?? '', /at least 6 characters/)
  assert.match(passwordErrorForAccount(password, true) ?? '', /at least 6 characters/,
    'staff resetting via the job-seeker page is still rejected below 6')
  assert.match(passwordErrorForAccount(password, false) ?? '', /at least 6 characters/)
}

// The whole 6–10 band is accepted for everyone, including staff, and longer
// passwords remain allowed — no upper bound for any account type.
for (let length = 6; length <= 10; length += 1) {
  const password = 'a'.repeat(length)
  assert.equal(userPasswordError(password), null, `user: ${length} chars accepted`)
  assert.equal(staffPasswordError(password), null, `staff: ${length} chars accepted`)
  assert.equal(passwordErrorForAccount(password, true), null, `staff via job-seeker page: ${length} chars accepted`)
}
for (const length of [11, 12, 20, 40, 64, 72]) {
  assert.equal(userPasswordError('a'.repeat(length)), null, `user: ${length} chars still accepted`)
  assert.equal(staffPasswordError('a'.repeat(length)), null, `staff: ${length} chars still accepted`)
}

// A password is measured exactly as typed (spaces count as characters).
assert.equal(userPasswordError('123456'), null)
assert.equal(passwordLengthError('      ', 6), null)

console.log('password rules: 6-character minimum for every account (job seeker, admin, vacancy team — on every page), no maximum — passed')
