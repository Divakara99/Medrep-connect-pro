/**
 * The job description is PUBLIC: every signed-in user can read it before
 * subscribing. These helpers are the single client-side definition of that
 * rule and are mirrored by the `public.vacancy_public_description_guard`
 * trigger in supabase/secure_jobs.sql.
 *
 * scripts/test-description-guard.mjs feeds the same inputs through this module
 * and through the real trigger so the two implementations cannot drift.
 */

// Built per call so no regular expression carries state between validations.
const EMAIL_SOURCE = '[^\\s@]+@[^\\s@]+\\.[A-Za-z]{2,}'
const PHONE_SOURCE = '\\+?[0-9][0-9 ()\\-.]{7,}[0-9]'

/**
 * Returns a user-facing reason when a public description contains confidential
 * contact details, or null when it is safe to publish.
 */
export function findConfidentialContact(description: string): string | null {
  if (new RegExp(EMAIL_SOURCE).test(description)) {
    return 'The description is public. Remove the email address and put it in the "Manager email" field instead.'
  }
  const candidates = description.match(new RegExp(PHONE_SOURCE, 'g')) ?? []
  if (candidates.some((candidate) => candidate.replace(/[^0-9]/g, '').length >= 10)) {
    return 'The description is public. Remove the phone number and use the "Contact" or "Manager alternate number" field instead.'
  }
  return null
}

/** True when the description is safe to publish to free users. */
export function isDescriptionPublicSafe(description: string): boolean {
  return findConfidentialContact(description) === null
}
