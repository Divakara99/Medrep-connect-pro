import type { Job } from './jobs'
import type { User } from './auth'
import { getProfile, type Profile } from './profile'
import { CREATOR } from './creator'
import { read, write } from './storage'

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
  sentAt: number
}

const QUEUE_KEY = 'mrc_applications_v1'

function newId() {
  return 'ap_' + Math.random().toString(36).slice(2, 10)
}

function buildTextContent(user: User, job: Job, profile: Profile, format: 'email' | 'whatsapp'): { subject: string; body: string } {
  const subject = `Application for ${job.title} position at ${job.company} – ${user.name}`

  const lines: string[] = []
  if (format === 'email') {
    lines.push(`Dear ${job.manager || 'Hiring Manager'},`)
    lines.push('')
    lines.push(`I am writing to apply for the ${job.title} position at ${job.company} (${job.location}), as advertised on MedRep Connect Pro.`)
  } else {
    lines.push(`*Job Application via MedRep Connect Pro*`)
    lines.push('')
    lines.push(`Hello ${job.manager || 'Hiring Manager'}, I would like to apply for the *${job.title}* position at *${job.company}* (${job.location}).`)
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
      lines.push(format === 'email' ? `• ${head}${e.duration ? ' (' + e.duration + ')' : ''}` : `• ${head}${e.duration ? ' (' + e.duration + ')' : ''}`)
      if (e.description) lines.push(format === 'email' ? `  ${e.description}` : `  ${e.description}`)
    })
  }

  lines.push('')
  if (format === 'email') {
    lines.push('I would welcome the opportunity to discuss how my experience fits your requirement. Please feel free to reach out to me at the phone/email above.')
    lines.push('')
    lines.push('Best regards,')
    lines.push(user.name)
    lines.push('')
    lines.push(`— Sent via MedRep Connect Pro (platform by ${CREATOR.name}, ${CREATOR.role}).`)
  } else {
    lines.push('Looking forward to your response. Please reach out to me at the contact above.')
    lines.push('')
    lines.push(`Regards,${format === 'whatsapp' ? '\n' : ' '}${user.name}`)
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

export function openApplication(user: User, job: Job): { ok: boolean; channel: 'email' | 'whatsapp'; to: string; record: ApplicationRecord; error?: string } {
  const profile = getProfile(user.email)
  const emailTo = (job.managerEmail || '').trim()
  const phoneTo = normalizePhone(job.contact)

  let channel: 'email' | 'whatsapp' = 'email'
  let to = emailTo
  let href = ''
  const { subject, body } = buildTextContent(user, job, profile, 'email')

  if (emailTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
    // Email first priority
    channel = 'email'
    to = emailTo
    href = `mailto:${encodeURIComponent(to)}?cc=${encodeURIComponent(CREATOR.adminEmail)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  } else if (phoneTo.length >= 10) {
    // Fallback to WhatsApp
    channel = 'whatsapp'
    to = phoneTo
    const w = buildTextContent(user, job, profile, 'whatsapp')
    href = `https://wa.me/${to}?text=${encodeURIComponent(w.body)}`
  } else {
    return { ok: false, channel: 'email', to: '', record: {} as ApplicationRecord, error: 'No manager email or contact number on this job — please notify admin.' }
  }

  const record: ApplicationRecord = {
    id: newId(),
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
    sentAt: Date.now(),
  }
  const queue = read<ApplicationRecord[]>(QUEUE_KEY, [])
  queue.unshift(record)
  write(QUEUE_KEY, queue.slice(0, 300))

  window.location.href = href
  return { ok: true, channel, to, record }
}

export function getApplicationQueue(): ApplicationRecord[] {
  return read<ApplicationRecord[]>(QUEUE_KEY, [])
}
