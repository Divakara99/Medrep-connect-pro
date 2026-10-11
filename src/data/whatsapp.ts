import type { Job } from './jobs'
import type { User } from './auth'
import { getProfile, type Profile } from './profile'
import { read, write } from './storage'

/**
 * MedRep Chatbot-side WhatsApp dispatcher.
 *
 * IMPORTANT: A real bot-sent WhatsApp requires a backend + WhatsApp Business
 * API provider (Twilio, Meta Cloud API, Gupshup, Wati, etc.). In this local PWA
 * we simulate the bot dispatch client-side: the message is composed from the
 * MedRep Bot identity, queued in localStorage, and shown as "sent by MedRep
 * Chatbot" — the user's own WhatsApp/number is never used to deliver it.
 *
 * When a real backend is wired in, `dispatchBotMessage` can POST to it and
 * the rest of the flow (UI, message shape) stays identical.
 */

export type BotConfig = {
  botName: string
  botNumber: string // WhatsApp Business number for the MedRep Bot
  provider: 'simulated' | 'meta-cloud' | 'gupshup' | 'twilio'
  enabled: boolean
}

const BOT_CONFIG_KEY = 'mrc_bot_config_v1'
const BOT_QUEUE_KEY = 'mrc_bot_queue_v1'

const DEFAULT_BOT_CONFIG: BotConfig = {
  botName: 'MedRep Chatbot',
  botNumber: '919676728619', // admin-controlled bot line
  provider: 'simulated',
  enabled: true,
}

export function getBotConfig(): BotConfig {
  return read<BotConfig>(BOT_CONFIG_KEY, DEFAULT_BOT_CONFIG)
}

export function saveBotConfig(cfg: BotConfig) {
  write(BOT_CONFIG_KEY, cfg)
}

export type BotMessage = {
  id: string
  jobId: string
  jobTitle: string
  company: string
  manager: string
  managerContact: string
  applicantName: string
  applicantEmail: string
  text: string
  status: 'queued' | 'sent' | 'delivered' | 'failed'
  sentBy: 'MedRep Chatbot'
  sentAt: number
}

export function buildBotMessage(user: User, job: Job): { text: string; profile: Profile } {
  const profile: Profile = getProfile(user.email)

  const lines: string[] = []
  lines.push(`*Application via MedRep Chatbot* 🤖`)
  lines.push(``)
  lines.push(`*Position:* ${job.title}`)
  lines.push(`*Company:* ${job.company}`)
  lines.push(`*Location:* ${job.location}`)
  lines.push(`*Category:* ${job.category}`)
  if (job.salary) lines.push(`*Salary:* ${job.salary}`)
  lines.push(``)
  lines.push(`*Candidate profile*`)
  lines.push(`• Name: ${user.name}`)
  lines.push(`• Email: ${user.email}`)
  lines.push(`• Phone: ${profile.phone || user.phone || '—'}`)
  lines.push(`• City/State: ${[profile.city, profile.state].filter(Boolean).join(', ') || '—'}`)
  if (profile.gender) lines.push(`• Gender: ${profile.gender}`)
  if (profile.dob) lines.push(`• DOB: ${profile.dob}`)
  if (profile.languages?.length) lines.push(`• Languages: ${profile.languages.join(', ')}`)
  if (profile.skills?.length) lines.push(`• Skills: ${profile.skills.join(', ')}`)
  if (profile.preferredRoles?.length) lines.push(`• Preferred roles: ${profile.preferredRoles.join(', ')}`)
  if (profile.ctc) lines.push(`• Expected CTC: ${profile.ctc}`)
  if (profile.noticePeriod) lines.push(`• Notice period: ${profile.noticePeriod}`)
  if (profile.bio) lines.push(`• Bio: ${profile.bio}`)

  if (profile.education.length) {
    lines.push(``)
    lines.push(`*Education*`)
    profile.education.forEach((e, i) => {
      lines.push(
        `${i + 1}. ${[e.degree, e.field].filter(Boolean).join(' – ')}${e.institution ? ' | ' + e.institution : ''}${e.year ? ' (' + e.year + ')' : ''}`,
      )
    })
  }
  if (profile.experience.length) {
    lines.push(``)
    lines.push(`*Experience*`)
    profile.experience.forEach((e, i) => {
      lines.push(
        `${i + 1}. ${e.title}${e.company ? ' at ' + e.company : ''}${e.duration ? ' (' + e.duration + ')' : ''}${e.description ? ' — ' + e.description : ''}`,
      )
    })
  }

  lines.push(``)
  lines.push(`— This message was sent by *MedRep Chatbot* on behalf of the candidate. The candidate has not initiated this message from their personal WhatsApp. Please reply to this thread to connect with the candidate.`)

  return { text: lines.join('\n'), profile }
}

function normalizePhone(raw?: string): string {
  let p = (raw || '').replace(/[^\d+]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.startsWith('0')) p = '91' + p.slice(1)
  if (p.length === 10) p = '91' + p
  return p
}

export function dispatchBotMessage(user: User, job: Job): { ok: boolean; message: BotMessage; error?: string } {
  const cfg = getBotConfig()
  if (!cfg.enabled) {
    return { ok: false, message: {} as BotMessage, error: 'MedRep Chatbot is currently disabled.' }
  }
  const managerPhone = normalizePhone(job.contact)
  if (managerPhone.length < 10) {
    return { ok: false, message: {} as BotMessage, error: 'Manager contact is missing or invalid.' }
  }
  const { text } = buildBotMessage(user, job)

  const m: BotMessage = {
    id: 'bm_' + Math.random().toString(36).slice(2, 10),
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    manager: job.manager || 'Hiring Manager',
    managerContact: managerPhone,
    applicantName: user.name,
    applicantEmail: user.email,
    text,
    status: 'sent',
    sentBy: 'MedRep Chatbot',
    sentAt: Date.now(),
  }

  // Persist to bot queue so the admin can see dispatched applications.
  const queue = read<BotMessage[]>(BOT_QUEUE_KEY, [])
  queue.unshift(m)
  write(BOT_QUEUE_KEY, queue.slice(0, 200))

  // In a production build we would POST to the backend here:
  //   await fetch('/api/bot/send', { method: 'POST', body: JSON.stringify({ to: managerPhone, text, from: cfg.botNumber }) })
  // For this local demo we mark it as sent immediately after the write above.

  return { ok: true, message: m }
}

export function getBotQueue(): BotMessage[] {
  return read<BotMessage[]>(BOT_QUEUE_KEY, [])
}

export function updateBotMessageStatus(id: string, status: BotMessage['status']) {
  const queue = read<BotMessage[]>(BOT_QUEUE_KEY, [])
  const idx = queue.findIndex((m) => m.id === id)
  if (idx >= 0) {
    queue[idx] = { ...queue[idx], status }
    write(BOT_QUEUE_KEY, queue)
  }
}
