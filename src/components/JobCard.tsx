import { Card } from './ui'
import { unlockButtonLabel, type UnlockStage } from '../data/adConfig'
import type { Job } from '../data/jobs'
import { salaryParts } from '../data/salaryText'
import { isPharmaSalesCategory, normalizeIndianMobile, parseHeadquarters } from '../data/vacancyRules'
import { useUnlockWindow } from './useUnlockWindow'
import { ShareJobButton } from './ShareJobButton'

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const h = Math.floor(d / 3600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}

/* ------------------------------- icons ---------------------------------- */
/* Small line icons instead of emoji: they stay sharp at any size, keep one
   stroke weight across the card and never depend on the phone's emoji font. */

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  )
}

function MoneyIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2.5" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M6 10v4M18 10v4" />
    </svg>
  )
}

function PinIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 21s-6.2-5.7-6.2-10.2a6.2 6.2 0 1 1 12.4 0C18.2 15.3 12 21 12 21z" />
      <circle cx="12" cy="10.6" r="2.3" />
    </svg>
  )
}

function ChevronIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  )
}

/* -------------------------------- card ---------------------------------- */

export function JobCard({
  job,
  unlocked,
  onClick,
  onApply,
  onWatchUnlock,
  unlockStage = null,
}: {
  job: Job
  /** Subscription flag ONLY — never set this from a company unlock. */
  unlocked: boolean
  onClick?: () => void
  /** Start the existing profile-check and application-confirmation flow. */
  onApply?: (job: Job) => void
  /**
   * Android app, free users: watch a rewarded video to unlock this job's
   * company name. Omitted on the website, for subscribers, and once the
   * company is unlocked — the button never renders there.
   */
  onWatchUnlock?: (job: Job) => void
  unlockStage?: UnlockStage | null
}) {
  // Per-job company unlock, kept separate from `unlocked`: it reveals the
  // company name only, never the four contact fields or Apply. It is also
  // time-limited, so the card re-reads the window on a short clock.
  const unlockWindow = useUnlockWindow(job)
  const companyUnlocked = unlocked || unlockWindow.active
  // The company name is intentionally omitted from locked-job data, so do not
  // require job.company here. The app supplies this callback only for free users
  // on Android; subscribers, the website and already-unlocked cards omit it.
  const showUnlockButton = Boolean(onWatchUnlock && !companyUnlocked)
  const hasApplyEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((job.managerEmail || '').trim())
  const applyPhoneDigits = (job.contact || '').replace(/[^\d]/g, '')
  const hasApplyPhone = applyPhoneDigits.replace(/^0/, '').replace(/^91/, '').length === 10 || applyPhoneDigits.length >= 10
  const applyAccessibleLabel = hasApplyEmail ? 'Apply via Email' : hasApplyPhone ? 'Apply via WhatsApp' : 'Apply now'
  const applyLabel = hasApplyEmail ? 'Apply · Email' : hasApplyPhone ? 'Apply · WA' : 'Apply'
  const unlockCompactLabel = unlockStage === 'loading'
    ? 'Loading…'
    : unlockStage === 'watching'
      ? 'Watching…'
      : unlockStage === 'verifying'
        ? 'Verifying…'
        : 'Watch video'
  const salary = salaryParts(job.salary)
  const isPharmaRole = isPharmaSalesCategory(job.category)
  const hqEntries = isPharmaRole ? parseHeadquarters(job.hq) : []

  const status = unlocked
    ? { label: '✓ Unlocked', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
    : companyUnlocked
      ? { label: `✓ Company unlocked · ${unlockWindow.label} left`, tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
      : { label: 'Contact locked', tone: 'bg-slate-100 text-slate-600 ring-slate-200' }

  return (
    <Card
      className={`group overflow-hidden rounded-2xl border-[#e4e8f0] bg-white shadow-[0_10px_26px_-22px_rgba(23,34,94,0.55)] ${
        job.pinned ? 'ring-1 ring-amber-200' : ''
      }`}
    >
      <button type="button" onClick={onClick} className="w-full px-3 py-2 text-left sm:px-3.5">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 break-words text-sm font-extrabold !leading-[1.12] tracking-tight text-slate-900 group-hover:text-brand-800">
              {job.title}
            </h3>
            <ChevronIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4b57c8]" />
          </div>

          {companyUnlocked && job.company ? (
            <div className="mt-0.5 break-words text-xs font-semibold !leading-tight text-slate-700">{job.company}</div>
          ) : (
            <div className="mt-0.5 flex items-center gap-1 text-xs font-medium !leading-tight text-slate-500">
              <LockIcon className="h-3.5 w-3.5 shrink-0" />
              <span>Company details locked</span>
            </div>
          )}

          <div className="mt-1 flex items-start gap-1">
            <PinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4b57c8]" />
            <div className="min-w-0 break-words text-xs font-medium !leading-tight text-slate-700">
              <span>{job.location}</span>
              {hqEntries.length > 0 && (
                <span className="font-medium text-slate-500"> · HQ {hqEntries.join(', ')}</span>
              )}
            </div>
          </div>

          {salary.amount && (
            <div className="mt-1 inline-flex max-w-full flex-wrap items-baseline gap-x-1 gap-y-0 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-900 ring-1 ring-emerald-200/80">
              <MoneyIcon className="h-3.5 w-3.5 shrink-0 translate-y-[2px] text-emerald-700" />
              <span className="break-words text-xs font-extrabold !leading-tight">{salary.amount}</span>
              {salary.unit && <span className="text-xs font-semibold !leading-tight">{salary.unit}</span>}
            </div>
          )}
        </div>
      </button>

      {/* Footer strip: the tags that describe the role, then freshness and share. */}
      <div className="flex flex-wrap items-center gap-1 border-t border-[#eef1f8] px-3 py-1.5 sm:px-3.5">
        <span className="max-w-full rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold !leading-tight text-sky-800 ring-1 ring-sky-100">
          {job.experience || 'Fresher'}
        </span>
        <span className="max-w-full rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold !leading-tight text-violet-800 ring-1 ring-violet-100">{job.category}</span>
        {isPharmaRole && job.division && (
          <span className="max-w-full rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold !leading-tight text-indigo-800 ring-1 ring-indigo-100">{job.division}</span>
        )}
        {job.pinned && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold !leading-tight text-amber-900">★ Pinned</span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold !leading-tight ring-1 ${status.tone}`}>{status.label}</span>

        <div className="ml-auto flex items-center gap-1">
          <span className="text-[10px] font-medium italic !leading-tight text-slate-500">{timeAgo(job.postedAt)}</span>
          <ShareJobButton job={job} icon className="" />
        </div>
      </div>

      {(onApply || showUnlockButton) && (
        <div className={`border-t border-slate-100 px-3 py-1.5 ${onApply && showUnlockButton ? 'grid grid-cols-2 gap-1.5' : ''}`}>
          {onApply && (
            <button
              type="button"
              aria-label={applyAccessibleLabel}
              title={applyAccessibleLabel}
              onClick={() => onApply(job)}
              className="flex h-9 w-full min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl bg-emerald-500 px-2 text-center text-xs font-extrabold !leading-tight text-white shadow-[0_8px_18px_-12px_rgba(5,150,105,0.9)] transition hover:bg-emerald-600 active:scale-[0.99]"
            >
              {hasApplyPhone && !hasApplyEmail ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor">
                  <path d="M12.04 2A9.93 9.93 0 0 0 3.5 17.03L2 22l5.1-1.47A10 10 0 1 0 12.04 2Zm0 18.2a8.16 8.16 0 0 1-4.16-1.14l-.3-.18-3.02.87.89-2.94-.2-.31a8.2 8.2 0 1 1 6.79 3.7Zm4.5-6.14c-.25-.13-1.48-.73-1.71-.81-.23-.08-.4-.13-.56.13-.17.25-.65.81-.8.98-.15.17-.3.19-.55.06-.25-.13-1.06-.39-2.02-1.24-.75-.66-1.25-1.48-1.4-1.73-.15-.25-.02-.39.11-.52.11-.11.25-.3.38-.44.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.36-.77-1.86-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.09s.9 2.43 1.02 2.6c.13.17 1.77 2.71 4.28 3.8.6.26 1.07.41 1.44.52.61.19 1.17.16 1.61.1.49-.07 1.48-.61 1.69-1.2.21-.59.21-1.09.15-1.2-.06-.11-.23-.17-.48-.29Z" />
                </svg>
              ) : <span aria-hidden className="shrink-0">{hasApplyEmail ? '✉' : '↗'}</span>}
              <span className="min-w-0 truncate">{applyLabel}</span>
            </button>
          )}
          {showUnlockButton && (
            <button
              type="button"
              aria-label={unlockButtonLabel(unlockStage)}
              title={unlockButtonLabel(unlockStage)}
              disabled={unlockStage !== null}
              onClick={() => onWatchUnlock?.(job)}
              className="flex h-9 w-full min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl bg-slate-900 px-2 text-center text-xs font-extrabold !leading-tight text-white transition hover:bg-slate-800 active:scale-[0.99] disabled:opacity-60"
            >
              <span aria-hidden className="shrink-0">🎬</span>
              <span className="min-w-0 truncate">{unlockCompactLabel}</span>
            </button>
          )}
        </div>
      )}

      {unlocked && (
        <div className="border-t border-[#eef1f8] px-3 py-2 text-xs text-slate-700">
          Company: <span className="font-semibold text-slate-900">{job.company}</span>
          {job.manager ? <> · Manager: <span className="font-semibold text-slate-900">{job.manager}</span></> : null}
          {job.contact ? <> · Contact: <span className="font-semibold text-slate-900">{job.contact}</span></> : null}
          {job.managerAltPhone ? <> · <span className="font-extrabold text-brand-700">+91</span> <span className="font-semibold text-slate-900">{normalizeIndianMobile(job.managerAltPhone)}</span></> : null}
        </div>
      )}

    </Card>
  )
}
