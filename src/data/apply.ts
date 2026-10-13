import type { Job } from './jobs'
import type { User } from './auth'
import type { ResumeRecord } from './resume'
import { getProfile, type Profile } from './profile'
import { CREATOR } from './creator'
import { mirror, supabase } from './supabase'

/**
 * Job applications.
 *
 * The application record is stored server-side (public.applications) through the
 * record_application RPC, which stamps the caller's verified identity. Admins
 * review the same table; a user only ever sees their own rows.
 *
 * The resume itself is never copied here — only its file name and the id of the
 * private resume_documents row. Browsers cannot attach a file to a mailto: link,
 * so the UI offers an authorized download of the stored resume instead of
 * pretending it was attached.
 */
export type ApplicationRecord = {
  id: string
  jobId: string
  jobTitle: string
  company: string
  manager: string
  channel: 'email' | 'whatsapp'
  to: string // email or phone
  applicantName: string
  applicantEmail: string
  subject?: string
  body: string
  resumeDocumentId?: string
  resumeFileName?: string
  sentAt: number
}

/**
 * The salutation every application opens with.
 *
 * A vacancy records the manager's name and contact details, never their gender,
 * so the message is addressed respectfully without guessing: "Respected
 * Sir/Madam," is correct whether the reader is a man or a woman, and it stays
 * right when no manager name is on file.
 */
const APPLICATION_SALUTATION = 'Respected Sir/Madam,'

function buildTextContent(user: User, job: Job, profile: Profile, format: 'email' | 'whatsapp'): { subject: string; body: string } {
  const subject = `Application for ${job.title} position at ${job.company} – ${user.name}`

  const lines: string[] = []
  if (format === 'email') {
    lines.push(APPLICATION_SALUTATION)
    lines.push('')
    lines.push(`I am writing to apply for the ${job.title} position at ${job.company} (${job.location}), as advertised on MedRep Connect Pro.`)
  } else {
    lines.push(`*Job Application via MedRep Connect Pro*`)
    lines.push('')
    lines.push(`${APPLICATION_SALUTATION} I would like to apply for the *${job.title}* position at *${job.company}* (${job.location}).`)
  }
  lines.push('')
  lines.push(format === 'email' ? 'Please find my profile details below:' : '*My profile details:*')
  lines.push('')

  const push = (label: string, value: string) => {
    if (!value) return
    if (format === 'email') lines.push(`${label.padEnd(16)}${value}`)
    else lines.push(`• *${label}:* ${value}`)
  }

  push('Name', user.name)
  push('Email', user.email)
  push('Phone', profile.phone || user.phone || '—')
  push('Location', [profile.city, profile.state].filter(Boolean).join(', ') || '—')
  if (profile.gender) push('Gender', profile.gender)
  if (profile.dob) push('DOB', profile.dob)
  if (profile.languages?.length) push('Languages', profile.languages.join(', '))
  if (profile.skills?.length) push('Skills', profile.skills.join(', '))
  if (profile.preferredRoles?.length) push('Preferred Roles', profile.preferredRoles.join(', '))
  if (profile.ctc) push('Expected CTC', profile.ctc)
  if (profile.noticePeriod) push('Notice Period', profile.noticePeriod)
  if (profile.bio) {
    lines.push(''); lines.push(format === 'email' ? 'Profile Summary:' : '*Summary:*')
    lines.push(profile.bio)
  }

  if (profile.education.length) {
    lines.push(''); lines.push(format === 'email' ? '--- EDUCATION ---' : '*Education*')
    profile.education.forEach((e, i) => {
      const head = [e.degree, e.field].filter(Boolean).join(' – ')
      const tail = [e.institution, e.year].filter(Boolean).join(' | ')
      lines.push(format === 'email' ? `• ${head}${tail ? ' — ' + tail : ''}` : `${i + 1}. ${head}${tail ? ' — ' + tail : ''}`)
    })
  }
  if (profile.experience.length) {
    lines.push(''); lines.push(format === 'email' ? '--- EXPERIENCE ---' : '*Experience*')
    profile.experience.forEach((e) => {
      const head = `${e.title}${e.company ? ' at ' + e.company : ''}`
      lines.push(`• ${head}${e.duration ? ' (' + e.duration + ')' : ''}`)
      if (e.description) lines.push(`  ${e.description}`)
    })
  }

  lines.push('')
  if (format === 'email') {
    lines.push('I would welcome the opportunity to discuss how my experience fits your requirement. Please feel free to reach out to me at the phone number or email address given above.')
    lines.push('')
    lines.push('Thank you for your time and consideration.')
    lines.push('')
    lines.push('Yours faithfully,')
    lines.push(user.name)
    lines.push('')
    lines.push(`— Sent via MedRep Connect Pro (platform by ${CREATOR.name}, ${CREATOR.role}).`)
  } else {
    lines.push('Thanking you. I look forward to your response and I am happy to share any further details you need.')
    lines.push('')
    lines.push(`Yours faithfully,\n${user.name}`)
    lines.push('')
    lines.push(`_Sent via MedRep Connect Pro._`)
  }
  return { subject, body: lines.join('\n') }
}

function normalizePhone(raw?: string): string {
  let p = (raw || '').replace(/[^\d+]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.startsWith('0')) p = '91' + p.slice(1)
  if (p.length === 10) p = '91' + p
  return p
}

/**
 * Open the mail/WhatsApp composer WITHOUT unloading the app, so the user stays
 * on the applications screen and still sees the confirmation. A detached anchor
 * click hands the URL to the OS instead of navigating this document.
 */
function openComposer(href: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.rel = 'noopener'
  anchor.target = '_blank'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export type OpenApplicationResult =
  | { ok: true; channel: 'email' | 'whatsapp'; to: string; record: ApplicationRecord; historyError?: string }
  | { ok: false; channel: 'email' | 'whatsapp'; to: string; error: string }

export async function openApplication(
  user: User,
  job: Job,
  resume?: ResumeRecord | null,
): Promise<OpenApplicationResult> {
  const profile = getProfile(user.email)
  const emailTo = (job.managerEmail || '').trim()
  const phoneTo = normalizePhone(job.contact)

  let channel: 'email' | 'whatsapp' = 'email'
  let to = emailTo
  let href = ''
  const { subject, body } = buildTextContent(user, job, profile, 'email')

  if (emailTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
    channel = 'email'
    to = emailTo
    href = `mailto:${encodeURIComponent(to)}?cc=${encodeURIComponent(CREATOR.adminEmail)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  } else if (phoneTo.length >= 10) {
    channel = 'whatsapp'
    to = phoneTo
    const whatsapp = buildTextContent(user, job, profile, 'whatsapp')
    href = `https://wa.me/${to}?text=${encodeURIComponent(whatsapp.body)}`
  } else {
    return { ok: false, channel: 'email', to: '', error: 'No manager email or contact number on this job — please notify admin.' }
  }

  const record: ApplicationRecord = {
    id: '',
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    manager: job.manager || 'Hiring Manager',
    channel,
    to,
    applicantName: user.name,
    applicantEmail: user.email,
    subject: channel === 'email' ? subject : undefined,
    body,
    resumeDocumentId: resume?.id,
    resumeFileName: resume?.fileName,
    sentAt: Date.now(),
  }

  // The server assigns the id and stamps the verified identity. If the
  // applications migration is not live yet we still open the composer — the
  // user's message is the point — but we never claim a history record exists.
  const { data, error } = await supabase.rpc('record_application', {
    p_payload: { ...record, id: undefined },
  })
  let stored = ''
  let historyError: string | undefined
  if (error) {
    const missing = /could not find the function|record_application/i.test(error.message)
    historyError = missing
      ? 'Opened, but it could not be added to your application history yet — the platform is still updating.'
      : error.message || 'Opened, but it could not be added to your application history.'
  } else {
    stored = (data as { id?: string } | null)?.id ?? ''
  }
  record.id = stored
  // Admin-side mirror for the dashboard listing; the RPC row is authoritative.
  if (stored) mirror('applications', record)

  myApplicationCache = null
  openComposer(href)
  return { ok: true, channel, to, record, historyError }
}

type StoredApplication = Partial<ApplicationRecord> & { id?: string }

function toApplicationRecord(value: unknown): ApplicationRecord | null {
  if (!value || typeof value !== 'object') return null
  const row = value as StoredApplication
  if (typeof row.id !== 'string' || typeof row.jobTitle !== 'string') return null
  return {
    id: row.id,
    jobId: row.jobId ?? '',
    jobTitle: row.jobTitle,
    company: row.company ?? '',
    manager: row.manager ?? 'Hiring Manager',
    channel: row.channel === 'whatsapp' ? 'whatsapp' : 'email',
    to: row.to ?? '',
    applicantName: row.applicantName ?? '',
    applicantEmail: row.applicantEmail ?? '',
    subject: row.subject,
    body: row.body ?? '',
    resumeDocumentId: row.resumeDocumentId,
    resumeFileName: row.resumeFileName,
    sentAt: typeof row.sentAt === 'number' ? row.sentAt : 0,
  }
}

/** The signed-in user's own application history. */
// In-memory only: the Account screen shows the last known history immediately
// and refreshes it in the background. Cleared on sign-out and on a new application.
let myApplicationCache: ApplicationRecord[] | null = null

/** The last known application history, or null if not loaded this session. */
export function getCachedMyApplications(): ApplicationRecord[] | null {
  return myApplicationCache
}

export function clearMyApplicationCache(): void {
  myApplicationCache = null
}

export async function listMyApplications(): Promise<ApplicationRecord[]> {
  const { data, error } = await supabase.rpc('list_my_applications')
  if (error) throw new Error(error.message || 'Your applications could not be loaded.')
  const records = ((data ?? []) as unknown[])
    .map(toApplicationRecord)
    .filter((record): record is ApplicationRecord => record !== null)
  myApplicationCache = records
  return records
}

let applicationCache: ApplicationRecord[] = []

/** Administrator view of every application recorded on the platform. */
export async function loadAllApplications(): Promise<ApplicationRecord[]> {
  const { data, error } = await supabase
    .from('applications')
    .select('id,data')
    .order('synced_at', { ascending: false })
    .limit(300)
  if (error) throw new Error(error.message || 'Applications could not be loaded.')
  const records = (((data ?? []) as { id: string; data: unknown }[])
    .map((row) => toApplicationRecord({ ...(row.data as StoredApplication), id: row.id })))
    .filter((record): record is ApplicationRecord => record !== null)
  applicationCache = records
  return records
}

/** Last admin load, for the synchronous dashboard counters and search. */
export function getCachedApplications(): ApplicationRecord[] {
  return applicationCache
}
