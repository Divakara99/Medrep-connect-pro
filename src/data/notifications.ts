import { CREATOR } from './creator'
import { mirror, supabase } from './supabase'
import { read, write } from './storage'
import { announcementBody, nextWatermark, notificationsToAlert, shouldChime } from './pushRules'
import { publishToEveryone } from './push'

export type Notification = {
  id: string
  title: string
  body: string
  type: 'job' | 'plan' | 'payment' | 'update' | 'system'
  createdAt: number
  readAt?: number
  from: string // sender name e.g. "Mr. Divakar Reddy · MedRep Connect Pro"
  meta?: Record<string, unknown>
  // target === 'all' for broadcasts, or a single user email, or array of emails
  target: 'all' | string[]
}

const NOTIF_KEY = 'mrc_notifications_v1'

function nid() {
  return 'n_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// ---------- Simple AI-style copy generator ----------
// Produces natural-looking update messages based on event type.
// (Purely local template AI — replace with LLM API later if desired.)
const SIGN_OFF = `— Mr. ${CREATOR.name}, ${CREATOR.role}, MedRep Connect Pro`

type EventKind =
  | { kind: 'job-posted'; jobTitle: string; category: string; location: string; pinned?: boolean }
  | { kind: 'job-edited'; jobTitle: string }
  | { kind: 'plans-updated' }
  | { kind: 'payments-updated' }
  | { kind: 'payment-confirmed'; planName: string; days: number; expiresAt: number; amount: number }
  | { kind: 'refund-processed'; amount: number; refundRef: string; method: string }
  | { kind: 'platform-update'; message?: string }
  | { kind: 'announcement'; title: string; message: string }
  | { kind: 'welcome'; userName: string }

// ---------- Notification sound (WebAudio chime, no asset needed) ----------
const SOUND_KEY = 'mrc_notif_sound_v1'

/** Sound is on unless the user switched it off on this device. */
export function soundEnabled(): boolean {
  return read<boolean>(SOUND_KEY, true) !== false
}

export function setSoundEnabled(enabled: boolean): void {
  write(SOUND_KEY, enabled !== false)
}

let audioCtx: AudioContext | null = null
export function playNotifSound() {
  if (!soundEnabled()) return
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audioCtx = audioCtx ?? new Ctx()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    // Two-tone pleasant chime: E5 → A5
    const notes = [
      { freq: 659.25, start: 0, dur: 0.12 },
      { freq: 880, start: 0.12, dur: 0.18 },
    ]
    for (const n of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = n.freq
      gain.gain.setValueAtTime(0.0001, now + n.start)
      gain.gain.exponentialRampToValueAtTime(0.22, now + n.start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + n.start)
      osc.stop(now + n.start + n.dur + 0.05)
    }
  } catch {
    // audio not available — ignore
  }
}

function generateCopy(ev: EventKind): { title: string; body: string } {
  switch (ev.kind) {
    case 'job-posted': {
      const pin = ev.pinned ? ' (priority pinned)' : ''
      const title = `New ${ev.category} opening${pin}`
      const body =
        `Hi 👋\n\nA new ${ev.category} role just went live on MedRep Connect Pro — ${ev.jobTitle}, ${ev.location}.\n\n` +
        `Mr. ${CREATOR.name} and the team review every posting to make sure it matches your job-seeker preferences. Open the app to check eligibility and apply.`
      return { title, body }
    }
    case 'job-edited':
      return {
        title: `Opening updated: ${ev.jobTitle}`,
        body:
          `Heads up 🔔\n\nThe posting for ${ev.jobTitle} was just updated by the admin team. Details like salary or location may have changed — worth a quick look if you were tracking it.`,
      }
    case 'plans-updated':
      return {
        title: 'Plans & pricing refreshed',
        body:
          `Hi there,\n\nWe've refreshed our subscription plans (new durations, better value) so you can pick the pack that fits your job hunt. Tap Plans to review — MR pins and manager contacts unlock instantly on payment.`,
      }
    case 'payments-updated':
      return {
        title: 'Payment options updated',
        body:
          `Quick update ✅\n\nWe've added/updated payment methods on the platform. Checkout is now smoother for UPI and Razorpay. Your active subscription (if any) is unaffected.`,
      }
    case 'payment-confirmed': {
      const exp = new Date(ev.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      return {
        title: 'Payment confirmed — plan activated! 🎉',
        body:
          `Great news!\n\nYour payment of ₹${ev.amount.toLocaleString('en-IN')} has been confirmed and your ${ev.planName} plan (${ev.days} days) is now ACTIVE.\n\n` +
          `🗓 Expiry date: ${exp}\nYou can now view company names, manager contacts, and apply to all vacancies with one tap.`,
      }
    }
    case 'refund-processed':
      return {
        title: 'Refund approved & processed ✅',
        body:
          `Your refund of ₹${ev.amount.toLocaleString('en-IN')} has been approved by the admin and processed via ${ev.method}.\n\n` +
          `Refund reference: ${ev.refundRef}\nIt should reflect in your account shortly (usually within 3–5 working days as per bank timelines).`,
      }
    case 'announcement':
      // The administrator writes the words; nothing is templated.
      return { title: ev.title.trim(), body: ev.message.trim() }
    case 'platform-update':
      return {
        title: 'Platform update',
        body:
          ev.message ||
          `We rolled out small improvements to MedRep Connect Pro: faster job load, better search filters, and a cleaner apply flow. Keep your profile up to date so recruiters can reach you faster!`,
      }
    case 'welcome':
      return {
        title: `Welcome to MedRep Connect Pro, ${ev.userName}!`,
        body:
          `Welcome aboard 🎉\n\nYou've joined India's first pharma-job network — MR vacancies are pinned first, followed by multi-industry roles across ABM, FMCG, Finance, Banking, IT, Healthcare and more.\n\n` +
          `Tip: Fill out your Account profile fully; recruiters are more likely to respond when your education, experience, and bio are complete. Subscribe to unlock company names, manager emails, and one-tap apply.\n\n` +
          `If you have feedback, drop it via the AI Help tab — I read every message.`,
      }
  }
}

export function broadcast(ev: EventKind, opts?: { from?: string; target?: 'all' | string[]; type?: Notification['type']; meta?: Record<string, unknown> }): Notification {
  const copy = generateCopy(ev)
  const typeMap: Record<EventKind['kind'], Notification['type']> = {
    'job-posted': 'job',
    'job-edited': 'job',
    'plans-updated': 'plan',
    'payments-updated': 'payment',
    'payment-confirmed': 'payment',
    'refund-processed': 'payment',
    'platform-update': 'update',
    announcement: 'update',
    welcome: 'system',
  }
  const notif: Notification = {
    id: nid(),
    title: copy.title,
    body: `${copy.body}\n\n${SIGN_OFF}`,
    type: opts?.type ?? typeMap[ev.kind],
    createdAt: Date.now(),
    from: opts?.from ?? `Mr. ${CREATOR.name} · MedRep Connect Pro`,
    target: opts?.target ?? 'all',
    meta: opts?.meta,
  }
  const existing = read<Notification[]>(NOTIF_KEY, [])
  existing.unshift(notif)
  write(NOTIF_KEY, existing.slice(0, 500))
  mirror('notifications', notif)
  // Targeting is implicit since all users read the global feed; per-user read state
  // is stored separately.
  // Audible alert for every new notification
  playNotifSound()
  return notif
}

export function getNotifications(): Notification[] {
  const existing = read<Notification[]>(NOTIF_KEY, [])
  if (existing.length === 0) {
    // Seed a welcome-to-the-platform broadcast on first launch
    const seed: Notification = {
      id: nid(),
      title: 'Welcome to MedRep Connect Pro',
      body:
        `Hi 👋\n\nWelcome to India's first pharma-job network — MR vacancies are pinned first, followed by multi-industry openings. Subscribe to unlock company names, manager contacts, and one-tap apply.\n\nIf you have questions, the AI Help tab is always on.\n\n${SIGN_OFF}`,
      type: 'system',
      createdAt: Date.now(),
      from: `Mr. ${CREATOR.name} · MedRep Connect Pro`,
      target: 'all',
    }
    write(NOTIF_KEY, [seed])
    return [seed]
  }
  return existing
}

function parseRemoteNotification(value: unknown): Notification | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.body !== 'string') return null
  const type: Notification['type'] = row.type === 'job' || row.type === 'plan' || row.type === 'payment'
    || row.type === 'update' || row.type === 'system'
    ? row.type
    : 'update'
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    from: typeof row.from === 'string' ? row.from : 'MedRep Connect Pro',
    target: 'all',
  }
}

/**
 * Merge broadcast notifications mirrored in Supabase into the local feed so
 * every user device receives new job posts and job updates (plus plan/payment
 * news) posted from the admin console. Failures are silent — the local feed
 * keeps working offline.
 */
export async function refreshNotificationsFromServer(): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('list_visible_notifications')
    if (error || !Array.isArray(data)) return
    const remote = (data as unknown[]).map(parseRemoteNotification).filter((n): n is Notification => n !== null)
    if (remote.length === 0) return
    const local = read<Notification[]>(NOTIF_KEY, [])
    const known = new Set(local.map((n) => n.id))
    const merged = [...local, ...remote.filter((n) => !known.has(n.id))]
    merged.sort((a, b) => b.createdAt - a.createdAt)
    write(NOTIF_KEY, merged.slice(0, 500))
  } catch {
    // Offline or RPC not installed yet — keep the local feed as-is.
  }
}

const READ_KEY = 'mrc_notif_read_v1'
function getReadMap(): Record<string, number> {
  return read<Record<string, number>>(READ_KEY, {})
}

export function getNotificationsForUser(_email: string): Notification[] {
  // In this demo all notifications are broadcasts; per-user read state is
  // tracked separately via the mrc_notif_read_v1 map.
  return getNotifications()
}

export function unreadCount(email: string): number {
  const read = getReadMap()
  const since = read[email.toLowerCase()] ?? 0
  return getNotifications().filter((n) => n.createdAt > since).length
}

export function markAllRead(email: string) {
  const read = getReadMap()
  read[email.toLowerCase()] = Date.now()
  write(READ_KEY, read)
}

export function markOneRead(email: string, id: string) {
  const list = getNotifications()
  const n = list.find((x) => x.id === id)
  if (!n) return
  const read = getReadMap()
  const prev = read[email.toLowerCase()] ?? 0
  read[email.toLowerCase()] = Math.max(prev, n.createdAt)
  write(READ_KEY, read)
}

// ---------------------------------------------------------------------------
// Announcements to everyone
// ---------------------------------------------------------------------------

/** The sign-off every broadcast carries, so the sender is always obvious. */
export function announcementSignOff(): string {
  return SIGN_OFF
}

export type AnnouncementResult =
  | { ok: true; notification: Notification; delivery: { sent: number; failed: number; removed: number; devices: number } | null; warning?: string }
  | { ok: false; error: string }

/**
 * Send an announcement to every user: the words are stored in the broadcast feed
 * (so it is visible in the app for good) and then pushed to every subscribed
 * phone, with sound. The push step is reported separately — the announcement
 * itself never fails because a phone could not be reached.
 */
export async function sendAnnouncement(title: string, message: string): Promise<AnnouncementResult> {
  const cleanTitle = title.trim()
  const cleanMessage = message.trim()
  if (!cleanTitle || !cleanMessage) return { ok: false, error: 'Write a title and a message before sending.' }

  const notification = broadcast({ kind: 'announcement', title: cleanTitle, message: cleanMessage })
  return publish(notification)
}

/**
 * Store a broadcast on the server and push it to every subscribed device. Used
 * for announcements and for vacancy posts/updates.
 */
export async function publish(notification: Notification): Promise<AnnouncementResult> {
  const { delivery, error } = await publishToEveryone(notification)
  if (error && !delivery) {
    return {
      ok: true,
      notification,
      delivery: null,
      warning: `Saved for every user. Phone notifications were not sent: ${error}`,
    }
  }
  return {
    ok: true,
    notification,
    delivery,
    warning: delivery && delivery.sent === 0 && delivery.devices === 0
      ? 'Saved for every user. No phone has notifications switched on yet — ask users to turn them on in the app.'
      : undefined,
  }
}

// ---------------------------------------------------------------------------
// Arriving announcements on a signed-in device
// ---------------------------------------------------------------------------

const SEEN_KEY = 'mrc_notif_seen_v1'
/** Never flood a phone: at most these many alerts per check. */
const MAX_ALERTS_PER_CHECK = 3

/**
 * Pull new broadcasts from the server and report the ones this device has not
 * seen yet, so the app can chime (and raise a system notification) even when the
 * user is sitting on another screen. The first check on a device only records a
 * watermark — a fresh install must not ring for the whole backlog.
 */
export async function refreshNotificationsAndAlert(): Promise<Notification[]> {
  const watermark = read<number>(SEEN_KEY, 0)
  const known = read<Notification[]>(NOTIF_KEY, []).map((item) => item.id)
  await refreshNotificationsFromServer()
  const merged = read<Notification[]>(NOTIF_KEY, [])
  const fresh = notificationsToAlert(merged, known, watermark, MAX_ALERTS_PER_CHECK)
  const next = nextWatermark(watermark, merged, fresh)
  if (next !== watermark) write(SEEN_KEY, next)
  return fresh
}

/** True when a new broadcast deserves a sound on this device. */
export function shouldChimeForAlert(alerted: Notification[]): boolean {
  return shouldChime(soundEnabled(), alerted.length)
}

export { announcementBody }
