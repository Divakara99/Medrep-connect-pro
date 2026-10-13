import { useState } from 'react'
import { Button, Badge, Modal } from './ui'
import { descriptionPoints, type Job } from '../data/jobs'
import type { ResumeRecord } from '../data/resume'
import { CREATOR } from '../data/creator'
import { RESUME_RETENTION_DAYS, resumeDownloadUrl } from '../data/resume'

function resolveChannel(job: Job): { channel: 'email' | 'whatsapp'; target: string } {
  const email = (job.managerEmail || '').trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { channel: 'email', target: email }
  return { channel: 'whatsapp', target: job.contact || '' }
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const h = Math.floor(d / 3600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h} hours ago`
  const days = Math.floor(h / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

function postedOn(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * A confidential value for an ACTIVE subscriber: visible, but blurred until
 * tapped — an anti-shoulder-surfing measure for real contact details.
 */
function SensitiveValue({ label, value, plus = false }: { label: string; value: string; plus?: boolean }) {
  const [revealed, setRevealed] = useState(false)
  if (!value) {
    return (
      <div className="rounded-xl ring-1 ring-slate-200 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-sm font-semibold text-slate-400">—</div>
      </div>
    )
  }
  return (
    <div className="rounded-xl ring-1 ring-slate-200 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <button
        type="button"
        onClick={() => setRevealed((show) => !show)}
        title={revealed ? 'Tap to blur again' : 'Tap to reveal'}
        className={`mt-0.5 w-full text-left text-sm font-semibold text-slate-900 transition ${revealed ? '' : 'blur-[5px] select-none'}`}
      >
        {plus ? <span className="text-brand-700 font-extrabold">(+)</span> : null}{value}
      </button>
      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mt-0.5">
        {revealed ? 'Tap to blur' : 'Blurred · tap to reveal'}
      </div>
    </div>
  )
}

/**
 * A locked PLACEHOLDER for a user without an active subscription. The server
 * never sends these values, so what is blurred here is a placeholder string —
 * there is nothing behind the blur to reveal.
 */
function LockedValue({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <div className="rounded-xl ring-1 ring-amber-200 bg-amber-50/40 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
        <span aria-hidden>🔒</span>{label}
      </div>
      <div className="mt-0.5 text-sm font-bold text-slate-400 blur-[5px] select-none" aria-hidden>{placeholder}</div>
      <div className="text-[9px] font-bold uppercase tracking-wide text-amber-700 mt-0.5">
        Locked · subscribe to unlock
      </div>
    </div>
  )
}

export function JobDetail({
  job,
  unlocked,
  onClose,
  onSubscribe,
  onApply,
}: {
  job: Job | null
  unlocked: boolean
  onClose: () => void
  onSubscribe: () => void
  onApply: (j: Job) => void
}) {
  const { channel } = job ? resolveChannel(job) : { channel: 'email' as const }
  const points = job ? descriptionPoints(job.description) : []

  return (
    <Modal open={!!job} onClose={onClose} title={job?.title}>
      {job && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white grid place-items-center font-bold shrink-0">
              {unlocked ? job.company.slice(0, 2).toUpperCase() : '🔒'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge color="brand">{job.category}</Badge>
                {job.pinned && <Badge color="amber">★ Pinned priority</Badge>}
              </div>
              <div className="text-sm text-slate-600 mt-1">
                {unlocked ? job.company : 'Company confidential'} · {timeAgo(job.postedAt)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                📅 Posted on <span className="font-semibold text-slate-700">{postedOn(job.postedAt)}</span>
              </div>
            </div>
          </div>

          {/* Always public and never blurred: role, city, HQ, division,
              experience, salary and posted date. */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Role" value={job.title} />
            <Field label="City" value={job.location} />
            <Field label="HQ" value={job.hq || '—'} />
            <Field label="Division" value={job.division || '—'} />
            <Field label="Experience" value={job.experience || '—'} />
            <Field label="Salary" value={job.salary || '—'} />
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 p-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Job description</div>
              <Badge color="slate">Public</Badge>
            </div>
            {points.length === 0 ? (
              <div className="text-sm text-slate-500">No description provided.</div>
            ) : (
              <ul className="space-y-1.5">
                {points.map((point, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-slate-800 leading-relaxed">
                    <span aria-hidden className="text-brand-600 font-extrabold shrink-0 leading-relaxed">(+)</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Hiring company & contact
            </div>
            {!unlocked ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <LockedValue label="Company name" placeholder="Hidden Pharma Pvt Ltd" />
                  <LockedValue label="Manager name" placeholder="Hiring Manager" />
                  <LockedValue label="Manager email" placeholder="manager@company.com" />
                  <LockedValue label="Contact number" placeholder="+91 90000 00000" />
                  <LockedValue label="Manager alternate number" placeholder="+91 80000 00000" />
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Only these five details wait for an active subscription. City, HQ, division, salary, experience,
                  posted date and the description above stay visible to everyone.
                </p>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <SensitiveValue label="Company name" value={job.company} />
                <SensitiveValue label="Manager name" value={job.manager || ''} />
                <Field label="Manager email" value={job.managerEmail || CREATOR.adminEmail} />
                <SensitiveValue label="ABM/ASM number" value={job.contact || ''} />
                <SensitiveValue label="Manager alternate number" value={job.managerAltPhone || ''} plus />
                <Field label="Posted on" value={postedOn(job.postedAt)} />
              </div>
            )}
          </div>

          {!unlocked ? (
            <Button className="w-full" variant="accent" onClick={onSubscribe}>
              💎 Subscribe to unlock & apply
            </Button>
          ) : (
            <Button className="w-full" onClick={() => onApply(job)}>
              {channel === 'email' ? '✉️ Apply via Email to Manager' : '💬 Apply via WhatsApp (no email on file)'}
            </Button>
          )}
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </Modal>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl ring-1 ring-slate-200 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900 truncate">{value}</div>
    </div>
  )
}

export function ApplyConfirmSheet({
  job,
  channel,
  target,
  resume,
  onClose,
  onConfirm,
  busy = false,
}: {
  job: Job | null
  channel: 'email' | 'whatsapp'
  target: string
  resume?: ResumeRecord | null
  onClose: () => void
  onConfirm: () => void
  busy?: boolean
}) {
  return (
    <Modal open={!!job} onClose={onClose} title={channel === 'email' ? 'Send application email' : 'Send WhatsApp message'}>
      {job && (
        <div className="space-y-4">
          {channel === 'email' ? (
            <div className="rounded-xl bg-gradient-to-br from-brand-50 to-indigo-50 p-4 ring-1 ring-brand-200 text-sm text-slate-800">
              <div className="flex items-start gap-2">
                <div className="text-xl">✉️</div>
                <div>
                  Tapping <span className="font-bold">Send</span> opens your mail app (Gmail / Outlook / Apple Mail) with a
                  fully pre-filled application addressed to the hiring manager. You stay on this screen.
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-green-50 p-4 ring-1 ring-emerald-200 text-sm text-slate-800">
              <div className="flex items-start gap-2">
                <div className="text-xl">💬</div>
                <div>
                  No manager email is on file for this vacancy — so tapping <span className="font-bold">Send</span> opens
                  WhatsApp in a new tab with a pre-filled message to the manager.
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl ring-1 ring-slate-200 p-3 text-sm space-y-1">
            {channel === 'email' ? (
              <>
                <div><span className="font-semibold text-slate-900">To:</span> {target || CREATOR.adminEmail}</div>
                <div><span className="font-semibold text-slate-900">Cc:</span> {CREATOR.adminEmail}</div>
                <div><span className="font-semibold text-slate-900">Subject:</span> Application for {job.title} at {job.company}</div>
              </>
            ) : (
              <>
                <div><span className="font-semibold text-slate-900">WhatsApp to:</span> {target || job.contact}</div>
                <div><span className="font-semibold text-slate-900">Manager:</span> {job.manager || '—'}</div>
              </>
            )}
            <div><span className="font-semibold text-slate-900">Role:</span> {job.title}</div>
            <div><span className="font-semibold text-slate-900">City:</span> {job.location}</div>
          </div>

          {resume ? (
            <div className="rounded-xl ring-1 ring-amber-200 bg-amber-50/50 p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="text-xl">📎</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900 truncate">{resume.fileName}</div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    Stored privately · auto-deleted after {RESUME_RETENTION_DAYS} days.
                  </div>
                </div>
              </div>
              <p className="text-xs text-amber-900">
                A browser mail link cannot carry a file. Tap <span className="font-bold">Download resume</span>, then attach
                that file in the mail app that opens next.
              </p>
              <ResumeDownloadButton resume={resume} />
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              No resume uploaded yet — add one in <span className="font-bold">Account → Profile details</span> so you can attach it to
              every application.
            </div>
          )}

          <div className="text-xs text-slate-500">
            {channel === 'email'
              ? 'Your mail app will open — simply tap Send after reviewing.'
              : 'WhatsApp opens in a new tab with a pre-formatted message — tap Send to deliver it to the manager.'}
            {' '}The application is also recorded in your Applications tab.
          </div>

          <Button className="w-full" onClick={onConfirm} disabled={busy}>
            {busy ? 'Preparing…' : channel === 'email' ? '✉️ Open mail app & send' : '💬 Open WhatsApp & send'}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>Cancel</Button>
        </div>
      )}
    </Modal>
  )
}

function ResumeDownloadButton({ resume }: { resume: ResumeRecord }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    setError(null)
    const result = await resumeDownloadUrl(resume)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const anchor = document.createElement('a')
    anchor.href = result.url
    anchor.download = resume.fileName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  return (
    <div className="space-y-1">
      <Button variant="secondary" className="px-3 py-2 text-xs" onClick={() => { void download() }} disabled={busy}>
        {busy ? 'Preparing secure link…' : '⬇ Download resume'}
      </Button>
      {error && <p role="alert" className="text-xs font-semibold text-red-800">{error}</p>}
    </div>
  )
}
