import { useState } from 'react'
import { unlockButtonLabel, type UnlockStage } from '../data/adConfig'
import { Button, Badge, Modal } from './ui'
import { descriptionPoints, type Job } from '../data/jobs'
import { isPharmaSalesCategory, normalizeIndianMobile, parseHeadquarters } from '../data/vacancyRules'
import type { ResumeRecord } from '../data/resume'
import { CREATOR } from '../data/creator'
import { resumeDownloadUrl } from '../data/resume'
import { usePaidUnlockWindow, useUnlockWindow } from './useUnlockWindow'
import { jobUnlockLabel } from '../data/jobUnlock'
import { ShareJobButton } from './ShareJobButton'

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
      <div className="rounded-2xl bg-slate-50/70 p-3.5 ring-1 ring-slate-200">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-sm font-semibold text-slate-400">—</div>
      </div>
    )
  }
  return (
    <div className="rounded-2xl bg-slate-50/70 p-3.5 ring-1 ring-slate-200">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <button
        type="button"
        onClick={() => setRevealed((show) => !show)}
        title={revealed ? 'Tap to blur again' : 'Tap to reveal'}
        className={`mt-0.5 w-full text-left text-sm font-semibold text-slate-900 transition ${revealed ? '' : 'blur-[5px] select-none'}`}
      >
        {plus ? <span className="text-brand-700 font-extrabold">+91&nbsp;</span> : null}{value}
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
        Locked
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
  onWatchUnlock,
  unlockStage = null,
  paidUnlock,
}: {
  job: Job | null
  /** Subscription flag ONLY — a company unlock must never set this. */
  unlocked: boolean
  onClose: () => void
  onSubscribe: () => void
  onApply: (j: Job) => void
  /** Android app, free users only: rewarded video for the company name. */
  onWatchUnlock?: (job: Job) => void
  unlockStage?: UnlockStage | null
  /**
   * The ₹5 single-job unlock — same price on the website and in the app.
   * `available` is false inside the app, where the rewarded video is the free
   * path and Razorpay is never opened.
   */
  paidUnlock?: { available: boolean; busy: boolean; onBuy: (job: Job) => void }
}) {
  // Per-job company unlock (rewarded video), separate from subscription — and
  // time-limited, so it is re-checked against the clock while the sheet is open.
  const unlockWindow = useUnlockWindow(job ?? { companyUnlocked: false, unlockExpiresAt: undefined })
  const companyUnlocked = Boolean(job && (unlocked || unlockWindow.active))
  // The paid ₹5 window reveals the whole contact block for this one job, so it
  // behaves like a pass for this sheet — and only for this sheet.
  const paidWindow = usePaidUnlockWindow(job ?? { jobUnlocked: false, jobUnlockExpiresAt: undefined })
  const fullDetails = Boolean(job && (unlocked || paidWindow.active))
  const points = job ? descriptionPoints(job.description) : []
  const isPharmaRole = Boolean(job && isPharmaSalesCategory(job.category))
  const hqItems = job && isPharmaRole ? parseHeadquarters(job.hq) : []
  const publicFields: { label: string; value: string; multiline?: boolean }[] = job
    ? [
        { label: 'Role', value: job.title },
        { label: 'City', value: job.location },
        ...(isPharmaRole ? [
          ...hqItems.map((hq, index) => ({
            label: hqItems.length > 1 ? `HQ ${index + 1}` : 'HQ',
            value: hq,
          })),
          { label: 'Division', value: job.division ?? '' },
        ] : []),
        { label: 'Experience', value: job.experience ?? '' },
        { label: 'Qualification', value: job.qualification ?? '' },
        { label: 'Age limit', value: job.ageLimit ?? '' },
        { label: 'Vacancies', value: job.vacancyCount ?? '' },
        { label: 'Salary', value: job.salary ?? '' },
      ].filter((field) => field.value.trim())
    : []

  return (
    <Modal open={!!job} onClose={onClose} onBack={onClose} title={job?.title}>
      {job && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white grid place-items-center font-bold shrink-0">
              {companyUnlocked && job.company ? job.company.slice(0, 2).toUpperCase() : '🔒'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge color="brand">{job.category}</Badge>
                {job.pinned && <Badge color="amber">★ Pinned priority</Badge>}
              </div>
              <div className="text-sm text-slate-600 mt-1">
                {companyUnlocked && job.company ? job.company : 'Company confidential'} · {timeAgo(job.postedAt)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                📅 Posted on <span className="font-semibold text-slate-700">{postedOn(job.postedAt)}</span>
              </div>
            </div>
          </div>

          {/* Public details only: pharma-specific fields appear only on MR/ABM roles,
              while optional empty fields are omitted instead of showing dashes. */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {publicFields.map((field) => (
              <Field key={field.label} label={field.label} value={field.value} multiline={field.multiline} />
            ))}
          </div>

          {(job.extraFields?.length ?? 0) > 0 && (
            <div className="rounded-2xl bg-slate-50/70 p-3.5 ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">More details</div>
                <Badge color="slate">Public</Badge>
              </div>
              <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {(job.extraFields ?? []).map((field) => (
                  <div key={field.label} className="min-w-0 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-200">
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{field.label}</dt>
                    <dd className="break-words text-sm font-semibold text-slate-900">{field.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div className="rounded-2xl bg-slate-50/70 p-3.5 ring-1 ring-slate-200">
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
                    <span aria-hidden className="text-brand-600 font-extrabold shrink-0 leading-relaxed">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl bg-slate-50/70 p-3.5 ring-1 ring-slate-200">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Hiring company & contact
            </div>
            {!fullDetails && companyUnlocked ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <SensitiveValue label="Company name" value={job.company} />
                  <LockedValue label="Manager name" placeholder="Hiring Manager" />
                  <LockedValue label="Manager email" placeholder="manager@company.com" />
                  <LockedValue label="Contact number" placeholder="+91 90000 00000" />
                  <LockedValue label="Manager alternate number" placeholder="+91 80000 00000" />
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Company name open ✓ for {unlockWindow.label} more. Contacts still need a pass.
                </p>
              </>
            ) : !fullDetails ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <LockedValue label="Company name" placeholder="Hidden Pharma Pvt Ltd" />
                  <LockedValue label="Manager name" placeholder="Hiring Manager" />
                  <LockedValue label="Manager email" placeholder="manager@company.com" />
                  <LockedValue label="Contact number" placeholder="+91 90000 00000" />
                  <LockedValue label="Manager alternate number" placeholder="+91 80000 00000" />
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Only these five wait for a pass. Everything else is free.
                </p>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <SensitiveValue label="Company name" value={job.company} />
                <SensitiveValue label="Manager name" value={job.manager || ''} />
                <Field label="Manager email" value={job.managerEmail || CREATOR.adminEmail} />
                <SensitiveValue label="ABM/ASM number" value={job.contact || ''} />
                <SensitiveValue label="Manager alternate number" value={normalizeIndianMobile(job.managerAltPhone || '')} plus />
                <Field label="Posted on" value={postedOn(job.postedAt)} />
              </div>
            )}
          </div>

          {paidWindow.active && (
            <p className="text-center text-xs font-bold text-emerald-700">
              {job.jobUnlockExpiresAt
                ? `Full contact unlocked for this job · ${paidWindow.label} left`
                : 'Full contact unlocked for this job — it stays open'}
            </p>
          )}
          {!fullDetails ? (
            <>
              {!companyUnlocked && onWatchUnlock && (
                <Button className="w-full" variant="secondary" disabled={unlockStage !== null} onClick={() => onWatchUnlock(job)}>
                  {unlockButtonLabel(unlockStage)}
                </Button>
              )}
              {/* Buying one job and opening the pass picker are peer actions:
                  keep them on the same row so both choices stay in view. */}
              <div className={paidUnlock?.available ? 'grid grid-cols-2 gap-2' : ''}>
                {paidUnlock?.available && (
                  <Button
                    className="w-full min-w-0 whitespace-normal break-words px-2 text-center text-sm leading-tight"
                    disabled={paidUnlock.busy}
                    onClick={() => paidUnlock.onBuy(job)}
                    aria-label={paidUnlock.busy ? 'Opening secure checkout' : jobUnlockLabel()}
                  >
                    {paidUnlock.busy ? 'Opening…' : `🔓 ${jobUnlockLabel()}`}
                  </Button>
                )}
                {/* Opens the pass-selection screen; it is not a silent select. */}
                <Button
                  className={`w-full whitespace-normal break-words px-2 text-center text-sm leading-tight ${paidUnlock?.available ? 'min-w-0' : ''}`}
                  variant="secondary"
                  onClick={onSubscribe}
                >
                  🔓 Unlock all jobs
                </Button>
              </div>
              <p className="text-center text-xs font-medium text-slate-500">
                {paidUnlock?.available
                  ? '₹5 unlocks this job; a pass unlocks all jobs.'
                  : 'Choose a pass to unlock all job contacts.'}
              </p>
            </>
          ) : (
            <Button className="w-full" onClick={() => onApply(job)}>
              ✉️ Apply
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="flex-1" onClick={onClose}>
              Close
            </Button>
            {/* Just the glyph: sharing is a small action here, not a headline. */}
            <ShareJobButton job={job} icon />
          </div>
        </div>
      )}
    </Modal>
  )
}

function Field({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="rounded-2xl bg-slate-50/70 p-3.5 ring-1 ring-slate-200">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-semibold text-slate-900 ${multiline ? 'whitespace-pre-line break-words' : 'truncate'}`}>{value}</div>
    </div>
  )
}

export function ApplyConfirmSheet({
  job,
  channel,
  resume,
  onClose,
  onSelectChannel,
  busy = false,
}: {
  job: Job | null
  channel: 'email' | 'whatsapp' | null
  resume?: ResumeRecord | null
  onClose: () => void
  onSelectChannel: (channel: 'email' | 'whatsapp') => void
  busy?: boolean
}) {
  const email = (job?.managerEmail || '').trim()
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const phone = (job?.contact || '').replace(/\D/g, '')
  const hasPhone = phone.length >= 10

  return (
    <Modal open={!!job} onClose={onClose} title="Choose how to apply">
      {job && (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Choose WhatsApp or email for <span className="font-bold">{job.title}</span> at {job.company || 'this company'}.
          </p>
          <button
            type="button"
            onClick={() => onSelectChannel('whatsapp')}
            disabled={busy || !hasPhone}
            className="flex w-full items-center gap-3 rounded-xl bg-emerald-50 p-3 text-left ring-1 ring-emerald-200 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-xl">💬</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-slate-900">WhatsApp</span>
              <span className="block truncate text-xs text-slate-600">{hasPhone ? job.contact : 'No manager contact number on file'}</span>
            </span>
            <span className="shrink-0 text-sm font-bold text-emerald-800">{busy && channel === 'whatsapp' ? 'Opening…' : 'Open →'}</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectChannel('email')}
            disabled={busy || !hasEmail}
            className="flex w-full items-center gap-3 rounded-xl bg-brand-50 p-3 text-left ring-1 ring-brand-200 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-xl">✉️</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-slate-900">Email</span>
              <span className="block truncate text-xs text-slate-600">{hasEmail ? email : 'No manager email on file'}</span>
            </span>
            <span className="shrink-0 text-sm font-bold text-brand-800">{busy && channel === 'email' ? 'Opening…' : 'Open →'}</span>
          </button>
          {resume ? (
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
              To attach your resume to an email, download it here first; then attach it after your mail app opens.
              <div className="mt-2"><ResumeDownloadButton resume={resume} /></div>
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-200">
              Your chosen app opens with a prepared application. Review it there, then tap Send.
            </p>
          )}
          <Button variant="ghost" className="w-full" onClick={onClose} disabled={busy}>Cancel</Button>
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
