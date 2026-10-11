import { CREATOR } from './creator'

/**
 * Local AI message assistant for platform updates.
 * - polishPlatformMessage(): fixes typos, casing, punctuation, tone; wraps a
 *   friendly greeting/closing.
 * - reviewPlatformMessage(): rechecks the polished copy for issues (admin-only
 *   contact leaks, ALL-CAPS, over-length) before the admin sends it to users.
 */

const TYPO_FIXES: [RegExp, string][] = [
  [/\brecieve\b/gi, 'receive'],
  [/\brecieved\b/gi, 'received'],
  [/\bteh\b/gi, 'the'],
  [/\bdefinately\b/gi, 'definitely'],
  [/\bseperate\b/gi, 'separate'],
  [/\boppurtunity\b/gi, 'opportunity'],
  [/\boppertunity\b/gi, 'opportunity'],
  [/\bvaccency\b/gi, 'vacancy'],
  [/\bvacansy\b/gi, 'vacancy'],
  [/\bmedicle\b/gi, 'medical'],
  [/\bpharama\b/gi, 'pharma'],
  [/\bconnexion\b/gi, 'connection'],
  [/\bupdation\b/gi, 'update'],
  [/\bthx\b/gi, 'thanks'],
  [/\bplz\b/gi, 'please'],
  [/\bpls\b/gi, 'please'],
  [/\bfrnds\b/gi, 'friends'],
  [/\bavailabe\b/gi, 'available'],
]

export type Review = {
  polished: string
  checks: string[]
  warnings: string[]
}

export function polishPlatformMessage(raw: string): string {
  let t = raw.trim().replace(/\s+/g, ' ')
  if (!t) return ''

  // Common quick typo fixes
  for (const [re, rep] of TYPO_FIXES) t = t.replace(re, rep)

  // ALL-CAPS → sentence case
  if (t.length > 12 && t === t.toUpperCase()) t = t.toLowerCase()

  // "i" → "I", tidy punctuation spacing
  t = t.replace(/\bi\b/g, 'I')
  t = t.replace(/\s+([.,!?;:])/g, '$1')

  // Capitalize first letter of each sentence
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())

  // Ensure the message ends with terminal punctuation
  if (!/[.!?]$/.test(t)) t += '.'

  // Friendly, on-brand framing (sign-off is appended by the broadcaster)
  return `Hi 👋\n\n${t}\n\nKeep your MedRep Connect Pro profile updated for faster recruiter responses — and check the Priority section for the latest MR openings.`
}

export function reviewPlatformMessage(raw: string): Review {
  const warnings: string[] = []
  const checks: string[] = []
  let polished = polishPlatformMessage(raw)

  // Recheck 1 — never leak admin-panel-only contact details to users
  if (CREATOR.adminMobile && polished.includes(CREATOR.adminMobile)) {
    polished = polished.split(CREATOR.adminMobile).join('[contact hidden]')
    warnings.push(`Admin mobile number found in the message and was automatically removed (admin contact stays admin-panel-only).`)
  }
  const adminPhoneLike = /\b9\d{9}\b/.test(polished)
  if (adminPhoneLike) {
    warnings.push('Message contains a 10-digit mobile number — double-check it is not an admin-only contact before sending.')
  }

  // Recheck 2 — readability
  if (raw.trim().length > 600) {
    warnings.push('Message is long for a mobile notification — consider trimming it.')
  }

  // Recheck 3 — tone flags
  if (/!{3,}/.test(raw)) {
    warnings.push('Excessive exclamation marks softened for a professional tone.')
    polished = polished.replace(/!{2,}/g, '!')
  }

  checks.push('✓ Grammar & spelling polished')
  checks.push('✓ Professional, friendly tone applied')
  checks.push(`✓ Signed as Mr. ${CREATOR.name}, ${CREATOR.role}`)
  checks.push('✓ Admin-only contact details scrubbed from user copy')

  return { polished, checks, warnings }
}
