/**
 * Pure profile-completion rules shared by the editor and application flow.
 * Experience, DOB, gender, CTC, notice period, and resume are deliberately not
 * required: a fresher can apply with a complete job-ready profile.
 */
export const PROFILE_BIO_MIN_LENGTH = 20

export type ProfileCompletionCandidate = {
  phone?: unknown
  city?: unknown
  state?: unknown
  languages?: unknown
  skills?: unknown
  preferredRoles?: unknown
  bio?: unknown
  education?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hasTextItem(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => text(item).length > 0)
}

function hasValidIndianMobile(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  const local = digits.length === 14 && digits.startsWith('0091')
    ? digits.slice(4)
    : digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits
  return /^[6-9]\d{9}$/.test(local)
}

/** List the job-ready details still needed before the user may apply. */
export function profileCompletionIssues(
  profile: ProfileCompletionCandidate,
  fallbackPhone?: string,
): string[] {
  const issues: string[] = []
  const phone = text(profile.phone) || text(fallbackPhone)
  if (!hasValidIndianMobile(phone)) issues.push('a valid phone number')
  if (!text(profile.city)) issues.push('your city')
  if (!text(profile.state)) issues.push('your state')
  if (!hasTextItem(profile.languages)) issues.push('at least one language')
  if (!hasTextItem(profile.skills)) issues.push('at least one skill')
  if (!hasTextItem(profile.preferredRoles)) issues.push('at least one preferred role')

  const education = Array.isArray(profile.education) ? profile.education : []
  const hasCompleteEducation = education.some((item) => {
    if (!item || typeof item !== 'object') return false
    const row = item as Record<string, unknown>
    return Boolean(text(row.degree) && text(row.institution) && text(row.year))
  })
  if (!hasCompleteEducation) issues.push('one education entry with degree, institution, and year')

  if (text(profile.bio).length < PROFILE_BIO_MIN_LENGTH) {
    issues.push(`a short profile summary (at least ${PROFILE_BIO_MIN_LENGTH} characters)`)
  }
  return issues
}
