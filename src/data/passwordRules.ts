/**
 * Password policy — both limits in one place.
 *
 * Regular job-seeker accounts (sign-up and password reset) only need 6
 * characters, so 6–10 character passwords are accepted and longer passwords
 * keep working unchanged. Administrator accounts and vacancy-team logins keep
 * the stricter 12-character rule.
 *
 * These checks are a convenience for the user, not the security boundary: the
 * Supabase Auth project's own **minimum password length** setting must be 6 (or
 * lower), otherwise the Auth service rejects a short password even though this
 * app accepts it. See DEPLOY.md.
 */
export const MIN_USER_PASSWORD_LENGTH = 6
export const MIN_STAFF_PASSWORD_LENGTH = 12

/** Error message for a too-short password, or null when the password is fine. */
export function passwordLengthError(password: string, minimumLength: number): string | null {
  if (password.length >= minimumLength) return null
  return `Password must be at least ${minimumLength} characters.`
}

/** Regular account rule (sign-up / password reset): 6 characters minimum. */
export function userPasswordError(password: string): string | null {
  return passwordLengthError(password, MIN_USER_PASSWORD_LENGTH)
}

/** Administrator and vacancy-team rule: 12 characters minimum (unchanged). */
export function staffPasswordError(password: string): string | null {
  return passwordLengthError(password, MIN_STAFF_PASSWORD_LENGTH)
}
