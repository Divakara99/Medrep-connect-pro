// The text that leaves the app when someone shares a vacancy.
//
// Anyone — free or subscribed — may share a job with a friend. What they share
// is the vacancy as everybody can already see it: role, category, city, HQ,
// division, experience, qualification, salary, vacancies, posted date and the
// public description. Contact information never travels: no company name, no
// manager name, no email, no phone numbers. Those stay behind the paywall and
// are only ever released by the server to the person who opens the vacancy in
// the app.
//
// The Play Store link is always appended, so the friend lands on the app rather
// than on a job they cannot open.
//
// This module has no runtime imports on purpose: it is unit-tested directly.

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=in.medrepconnect.app'

/** The only fields a share is allowed to read. Contact fields are not in it. */
export type ShareableVacancy = {
  title?: string
  category?: string
  location?: string
  hq?: string
  division?: string
  experience?: string
  qualification?: string
  salary?: string
  vacancyCount?: string
  ageLimit?: string
  description?: string
  postedAt?: number
}

/** The share sheet's title — the app name, never the employer. */
export const SHARE_TITLE = 'MedRep Pro vacancy'

/** Descriptions are entered one point per line; the leading bullet is stripped. */
function descriptionBullets(description?: string, limit = 6): string[] {
  return (description || '')
    .split(/\r?\n|•/)
    .map((line) => line.replace(/^\s*(?:\(\+\)|[*•\u2022-])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, limit)
}

function postedOn(ts?: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The message a share produces.
 *
 * Built only from the fields listed in `ShareableVacancy`, so an employer's
 * name or a manager's phone number cannot slip out even if the caller passes
 * the whole job object.
 */
export function shareJobText(job: ShareableVacancy): string {
  const rows: Array<[string, string | undefined]> = [
    ['Role', job.title],
    ['Category', job.category],
    ['City', job.location],
    ['HQ', (job.hq || '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).join(', ')],
    ['Division', job.division],
    ['Experience', job.experience],
    ['Qualification', job.qualification],
    ['Salary', job.salary],
    ['Vacancies', job.vacancyCount],
    ['Age limit', job.ageLimit],
    ['Posted', postedOn(job.postedAt)],
  ]

  const lines = ['MedRep Pro — vacancy shared with you', '']
  for (const [label, value] of rows) {
    const text = (value || '').trim()
    if (text) lines.push(`${label}: ${text}`)
  }

  const bullets = descriptionBullets(job.description)
  if (bullets.length > 0) {
    lines.push('', 'Job description:')
    for (const bullet of bullets) lines.push(`• ${bullet}`)
  }

  lines.push(
    '',
    'Company name, manager name and contact numbers are shown only inside the app.',
    `Open MedRep Pro: ${PLAY_STORE_URL}`,
  )

  return lines.join('\n')
}
