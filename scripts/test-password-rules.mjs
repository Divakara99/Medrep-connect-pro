import assert from 'node:assert/strict'
import {
  MIN_STAFF_PASSWORD_LENGTH,
  MIN_USER_PASSWORD_LENGTH,
  passwordLengthError,
  staffPasswordError,
  userPasswordError,
} from '../src/data/passwordRules.ts'

/**
 * Password policy (src/data/passwordRules.ts):
 *   - a regular job-seeker account (sign-up / password reset) needs 6
 *     characters, so 6–10 characters work and longer passwords stay valid;
 *   - administrator and vacancy-team passwords keep the 12-character minimum;
 *   - the message shown to the user names the exact minimum.
 */
assert.equal(MIN_USER_PASSWORD_LENGTH, 6, 'regular accounts start at 6 characters')
assert.equal(MIN_STAFF_PASSWORD_LENGTH, 12, 'admin and vacancy-team accounts keep 12 characters')
assert.equal(userPasswordError('12345'), `Password must be at least ${MIN_USER_PASSWORD_LENGTH} characters.`)
assert.equal(staffPasswordError('12345678901'), `Password must be at least ${MIN_STAFF_PASSWORD_LENGTH} characters.`)
assert.equal(passwordLengthError('1234567', 8), 'Password must be at least 8 characters.')

for (const password of ['', 'a', '12345', 'passw']) {
  const error = userPasswordError(password)
  assert.ok(error, `${password.length}-character password is rejected for a regular account`)
  assert.match(error, /at least 6 characters/)
  assert.equal(staffPasswordError(password), 'Password must be at least 12 characters.')
}

// The whole 6–10 band is accepted, including exactly 6 and exactly 10.
for (let length = MIN_USER_PASSWORD_LENGTH; length <= 10; length += 1) {
  const password = 'a'.repeat(length)
  assert.equal(userPasswordError(password), null, `a ${length}-character password is accepted`)
}

// Longer passwords remain allowed — no upper bound is introduced for users.
for (const length of [11, 12, 20, 40, 64, 72]) {
  assert.equal(userPasswordError('a'.repeat(length)), null, `a ${length}-character password is still accepted`)
}
assert.equal(staffPasswordError('a'.repeat(12)), null, 'a 12-character admin password is accepted')
assert.equal(staffPasswordError('a'.repeat(11)), 'Password must be at least 12 characters.', '11 characters stay too short for staff')
assert.equal(staffPasswordError('a'.repeat(72)), null, 'a long admin password is still accepted')

// A password is measured exactly as typed (spaces count as characters).
assert.equal(userPasswordError('123456'), null)
assert.equal(passwordLengthError('      ', 6), null)

console.log('password rules: 6-character job-seeker minimum (6–10 allowed, longer kept), staff still at 12 passed')
