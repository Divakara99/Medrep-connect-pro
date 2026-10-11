import { CREATOR } from './creator'

/**
 * HIGH-SECURITY: central secret registry + scrubber.
 * Nothing user-facing may ever contain these values. Every AI reply and any
 * dynamic user-facing text passes through `sanitizeSecrets()` first.
 */
export const APP_SECRETS: string[] = [
  CREATOR.adminPassword,
  CREATOR.adminMobile,
  CREATOR.adminEmail,
].filter(Boolean)

/** Also scrub digit-spaced variants of the admin mobile (e.g. 96767 28619). */
const SECRET_PATTERNS: RegExp[] = [
  /96\s?76\s?72\s?86\s?19/g, // admin mobile, spaced or not
  /9\s?9\s?5\s?9\s?8\s?2\s?7\s?8\s?2\s?6\s?[Dd]{1,2}\s?@?/g, // admin password, lightly spaced
]

export function sanitizeSecrets(text: string): string {
  let out = text
  for (const s of APP_SECRETS) {
    if (s && out.includes(s)) out = out.split(s).join('[secure]')
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[secure]')
  return out
}

/** Queries about the USER's own password recovery are not secret probes. */
const BENIGN_PASSWORD = /(forgot|reset|change|update|recover|set)\s+(my\s+)?(password|passcode|passwd)/i

/** True when a user query is fishing for secrets / admin access. */
const GENERIC_CREDENTIAL = /password|passcode|passwd|credential/i
const SECRET_PROBES: RegExp[] = [
  /96\s?76\s?72\s?86\s?19/,
  /9\s?9\s?5\s?9\s?8\s?2\s?7/,
  /admin\s?(id|login|password|pass|number|mobile|phone|contact|email|panel|access)/i,
  /(password|number|mobile|phone|contact|email|login)\s?(of|for)\s?(the\s?)?admin/i,
  /who\s+(is|created|owns)\s+(the\s?)?(admin|owner)/i,
  /(owner|creator|founder|developer)\s?(number|mobile|phone|contact|email|password)/i,
  /secret|api[\s._-]?key|razorpay\s?(key|secret|password)/i,
  /(enter|open|access|hack|crack|bypass|break)\w*\s*(the\s*)?(admin|panel|login)/i,
  /(logo|icon|medrep)\s?(tap|click|press)\w*\s*(time|count|again|admin)/i,
  /backdoor|cheat|mod\s?apk|unlock\s?(everything|all|premium|free)/i,
  /free\s?(premium|subscription|account)\s?(trick|hack|without)/i,
  /source\s?code|github|localStorage|where\w*\s*(is|are)\s*(the\s*)?(data|password|details)\s*stored/i,
  /(get|give|show|tell|send|share)\w*\s*(me\s*)?(the\s*)?(password|otp|pin|token|credential)/i,
]

export function isSecretProbe(q: string): boolean {
  if (BENIGN_PASSWORD.test(q) && !/admin/i.test(q)) return false
  return GENERIC_CREDENTIAL.test(q) || SECRET_PROBES.some((re) => re.test(q))
}
