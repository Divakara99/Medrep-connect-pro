/**
 * "Is this vacancy still open?"
 *
 * Two ways an administrator finds out, both from the Vacancies tab:
 *
 *   1. a message to the hiring manager on WhatsApp, with the vacancy named —
 *      an answer in seconds, nothing stored;
 *   2. a request to the vacancy team, stored in the vacancy as `fillCheck`.
 *      The team sees it at the top of their portal, answers Open or Filled, and
 *      the administrator's list shows the answer next to the row. That is what
 *      decides "delete it" or "keep it" without guessing.
 *
 * This module imports nothing, so the tests can load it directly.
 */

export type FillCheckAnswer = 'open' | 'filled'

export type FillCheck = {
  /** When the administrator asked the team. */
  askedAt?: number
  askedBy?: string
  /** What the team answered. */
  answer?: FillCheckAnswer
  answeredAt?: number
  answeredBy?: string
}

export type FillCheckState = 'none' | 'asked' | 'open' | 'filled'

/** Reads whatever was stored, ignoring anything malformed. */
export function parseFillCheck(value: unknown): FillCheck | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const answer = row.answer === 'open' || row.answer === 'filled' ? row.answer : undefined
  const fill: FillCheck = {
    askedAt: typeof row.askedAt === 'number' ? row.askedAt : undefined,
    askedBy: typeof row.askedBy === 'string' ? row.askedBy : undefined,
    answer,
    answeredAt: typeof row.answeredAt === 'number' ? row.answeredAt : undefined,
    answeredBy: typeof row.answeredBy === 'string' ? row.answeredBy : undefined,
  }
  return Object.values(fill).some((entry) => entry !== undefined) ? fill : undefined
}

/** The one word the list shows. */
export function fillCheckState(fill: FillCheck | undefined): FillCheckState {
  if (fill?.answer === 'filled') return 'filled'
  if (fill?.answer === 'open') return 'open'
  if (fill?.askedAt) return 'asked'
  return 'none'
}

/** True while the team has been asked and has not answered yet. */
export function fillCheckWaiting(fill: FillCheck | undefined): boolean {
  return fillCheckState(fill) === 'asked'
}

export const FILL_CHECK_LABELS: Record<FillCheckState, string> = {
  none: 'Not asked',
  asked: 'Waiting for reply',
  open: 'Team says: still open',
  filled: 'Team says: filled',
}

/** The message that goes to the hiring manager. Public details only. */
export function fillCheckWhatsAppText(job: {
  title: string
  company?: string
  location: string
  manager?: string
}): string {
  const who = job.manager?.trim() ? `Hello ${job.manager.trim()},` : 'Hello,'
  const where = job.company?.trim()
    ? `${job.title} at ${job.company.trim()}, ${job.location}`
    : `${job.title}, ${job.location}`
  return `${who} is the ${where} vacancy still open? Please reply YES (still open) or NO (filled). — MedRep Connect Pro`
}

/** A 10-digit Indian mobile, or nothing. */
function managerNumber(raw: string | undefined): string | null {
  let digits = (raw ?? '').replace(/\D/g, '')
  // "0091 98765 43210" is the same number written the international way.
  if (digits.startsWith('00')) digits = digits.slice(2)
  const local = digits.length === 12 && digits.startsWith('91')
    ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0')
      ? digits.slice(1)
      : digits
  return /^[6-9]\d{9}$/.test(local) ? local : null
}

/**
 * WhatsApp, addressed to the manager when the vacancy has a usable number, and
 * to the app chooser when it does not — never a dead link.
 */
export function fillCheckWhatsAppUrl(job: {
  title: string
  company?: string
  location: string
  manager?: string
  contact?: string
}): string {
  const text = encodeURIComponent(fillCheckWhatsAppText(job))
  const number = managerNumber(job.contact)
  return number ? `https://wa.me/91${number}?text=${text}` : `https://wa.me/?text=${text}`
}
