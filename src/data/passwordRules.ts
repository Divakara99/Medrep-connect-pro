/**
 * Password policy — one minimum for every account.
 *
 * Every account needs at least 6 characters: job seekers, administrators and
 * vacancy-team accounts alike (confirmed by the owner; there is no maximum —
 * longer passwords keep working unchanged). The constants keep their separate
 * names so callers that ask for "the staff rule" keep working, but both rules
 * are the same 6-character minimum now.
 *
 * In particular this closes the old reset hole: an admin or vacancy-team
 * member who reset their password through the job-seeker page was held to
 * the job-seeker minimum while the admin page demanded 12. Both pages now
 * resolve the minimum from the account's actual role (see
 * minimumForAccount) and both resolve to 6.
 *
 * These checks are a convenience for the user, not the security boundary: the
 * Supabase Auth project's own **minimum password length** setting must be 6
 * (or lower), otherwise the Auth service rejects a short password even though
 * this app accepts it. See DEPLOY.md / ANDROID.md.
 */
export const MIN_USER_PASSWORD_LENGTH = 6
export const MIN_STAFF_PASSWORD_LENGTH = 6

/** Error message for a too-short password, or null when the password is fine. */
export function passwordLengthError(password: string, minimumLength: number): string | null {
  if (password.length >= minimumLength) return null
  return `Password must be at least ${minimumLength} characters.`
}

/** Regular account rule (sign-up / password reset): 6 characters minimum. */
export function userPasswordError(password: string): string | null {
  return passwordLengthError(password, MIN_USER_PASSWORD_LENGTH)
}

/** Administrator and vacancy-team rule: the same 6 characters minimum. */
export function staffPasswordError(password: string): string | null {
  return passwordLengthError(password, MIN_STAFF_PASSWORD_LENGTH)
}

/**
 * The minimum for the account that is actually resetting its password,
 * whichever page the reset email opened. Staff (admin / vacancy-team) and
 * job-seeker accounts all use 6 today; resolving it from the role keeps the
 * job-seeker page honest if the staff rule is ever raised again.
 */
export function minimumForAccount(isStaff: boolean): number {
  return isStaff ? MIN_STAFF_PASSWORD_LENGTH : MIN_USER_PASSWORD_LENGTH
}

export function passwordErrorForAccount(password: string, isStaff: boolean): string | null {
  return passwordLengthError(password, minimumForAccount(isStaff))
}
