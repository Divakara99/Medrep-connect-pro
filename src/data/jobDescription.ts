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
export type VacancyDescriptionPrompt = {
  title: string
  rolePosition: string
  category: string
  location: string
  hq?: string
  division?: string
  experience?: string
  qualification?: string
  salary?: string
  vacancyCount?: string
}

/**
 * Offline, prompt-guided starter copy. It uses only details already entered by
 * the admin and generic duties, so it never invents contact details or claims.
 * The result is a draft for the editor to review, not an external AI response.
 */
export function generateVacancyDescriptionDraft(fields: VacancyDescriptionPrompt): string {
  const title = fields.title.trim()
  const role = fields.rolePosition.trim() || title || fields.category.trim()
  const location = fields.location.trim()
  const category = fields.category.trim()
  const lines = [
    title ? `We are looking for a ${title}${role && role !== title ? ` (${role})` : ''}.` : role ? `We are looking for a ${role}.` : '',
    location ? `Work location: ${location}.` : '',
    fields.hq?.trim() ? `HQ / Area: ${fields.hq.trim().replace(/\r?\n/g, ', ')}.` : '',
    fields.division?.trim() ? `Division: ${fields.division.trim()}.` : '',
    category === 'MR'
      ? 'Plan field visits and present relevant products to healthcare professionals in the assigned territory.'
      : category === 'ABM'
        ? 'Coordinate territory activities, support field representatives, and build professional relationships with healthcare teams.'
        : category === 'Field' || fields.rolePosition.trim()
          ? 'Meet customers in the assigned area, explain relevant products or services, and maintain professional relationships.'
          : `Carry out responsibilities relevant to the ${role || 'position'} and support the team’s day-to-day goals.`,
    'Share progress with the reporting team and follow company policies.',
    fields.experience?.trim() ? `Experience: ${fields.experience.trim()}.` : '',
    fields.qualification?.trim() ? `Qualification: ${fields.qualification.trim()}.` : '',
    fields.salary?.trim() ? `Salary: ${fields.salary.trim()}.` : '',
    fields.vacancyCount?.trim() ? `Openings: ${fields.vacancyCount.trim()}.` : '',
    'Apply through MedRep Connect Pro if this opportunity matches your profile.',
  ]
  return lines.filter(Boolean).join('\n')
}

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
