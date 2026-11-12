import { Card } from './ui'
import { unlockButtonLabel, type UnlockStage } from '../data/adConfig'
import type { Job } from '../data/jobs'
import { salaryParts } from '../data/salaryText'
import { normalizeIndianMobile } from '../data/vacancyRules'
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

function BuildingIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4h5A1.5 1.5 0 0 1 12 5.5V21" />
      <path d="M12 10h6.5A1.5 1.5 0 0 1 20 11.5V21" />
      <path d="M2.5 21h19" />
      <path d="M6.8 8h2.4M6.8 12h2.4M6.8 16h2.4M15.2 14h1.6M15.2 17.5h1.6" />
    </svg>
  )
}

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
  // Keep the rewarded action in the card's action area only when there is a
  // company name to reveal. The app supplies this callback only for free users
  // on Android; subscribers, the website and already-unlocked cards omit it.
  const showUnlockButton = Boolean(onWatchUnlock && job.company?.trim() && !companyUnlocked)
  const hasApplyEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((job.managerEmail || '').trim())
  const applyPhoneDigits = (job.contact || '').replace(/[^\d]/g, '')
  const hasApplyPhone = applyPhoneDigits.replace(/^0/, '').replace(/^91/, '').length === 10 || applyPhoneDigits.length >= 10
  const applyLabel = hasApplyEmail ? 'Apply via Email' : hasApplyPhone ? 'Apply via WhatsApp' : 'Apply now'
  const salary = salaryParts(job.salary)

  const status = unlocked
    ? { label: '✓ Unlocked', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
    : companyUnlocked
      ? { label: `✓ Company unlocked · ${unlockWindow.label} left`, tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
      : { label: 'Contact locked', tone: 'bg-slate-100 text-slate-600 ring-slate-200' }

  return (
    <Card
      className={`group overflow-hidden rounded-[26px] border-[#e9edf6] bg-white shadow-[0_16px_34px_-26px_rgba(23,34,94,0.55)] ${
        job.pinned ? 'ring-1 ring-amber-200' : ''
      }`}
    >
      <button type="button" onClick={onClick} className="w-full px-4 pb-4 pt-4 text-left">
        <div className="flex items-start gap-3">
          {/* One tile, like the reference: the employer mark. When the company
              is still locked there is nothing to show, so it is a lock. */}
          <div
            className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${
              companyUnlocked ? 'bg-[#e9ecfb] text-[#4b57c8]' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {companyUnlocked ? <BuildingIcon className="h-7 w-7" /> : <LockIcon className="h-6 w-6" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-lg font-extrabold leading-snug tracking-tight text-slate-900 group-hover:text-brand-800">
                  {job.title}
                </h3>
                {companyUnlocked && job.company ? (
                  <div className="mt-0.5 break-words text-sm font-semibold text-slate-700">{job.company}</div>
                ) : (
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span aria-hidden className="select-none text-[15px] font-medium italic text-slate-400 blur-[5px]">Hidden Pharma Pvt Ltd</span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">Locked</span>
                  </div>
                )}
              </div>
              <ChevronIcon className="mt-1 h-5 w-5 shrink-0 text-[#4b57c8]" />
            </div>

            {salary.amount && (
              <div className="mt-3 inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-900 ring-1 ring-emerald-200/80">
                <MoneyIcon className="h-4 w-4 shrink-0 translate-y-[2px] text-emerald-700" />
                <span className="break-words text-base font-extrabold leading-tight">{salary.amount}</span>
                {salary.unit && <span className="text-xs font-semibold">{salary.unit}</span>}
              </div>
            )}

            <div className="mt-2 flex items-start gap-2">
              <PinIcon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#4b57c8]" />
              <div className="min-w-0 break-words text-sm font-semibold leading-snug text-slate-700">
                <span>{job.location}</span>
                {job.hq && job.hq !== job.location && (
                  <span className="font-medium text-slate-500"> · HQ {job.hq}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </button>

      {/* Footer strip: the tags that describe the role, then freshness and share. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[#eef1f8] px-4 py-3">
        <span className="max-w-full rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800 ring-1 ring-sky-100">
          {job.experience || 'Fresher'}
        </span>
        <span className="max-w-full rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-800 ring-1 ring-violet-100">{job.category}</span>
        {job.pinned && (
          <span className="rounded-[10px] bg-amber-100 px-3 py-1 text-sm font-bold italic text-amber-900">★ Pinned</span>
        )}
        <span className={`rounded-[10px] px-3 py-1 text-sm font-bold italic ring-1 ${status.tone}`}>{status.label}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs font-medium italic text-slate-500">{timeAgo(job.postedAt)}</span>
          <ShareJobButton job={job} icon className="" />
        </div>
      </div>

      {onApply && (
        <div className="border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={() => onApply(job)}
            className="flex w-full min-w-0 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-3 text-center text-sm font-extrabold leading-snug text-white shadow-[0_8px_18px_-12px_rgba(5,150,105,0.9)] transition hover:bg-emerald-600 active:scale-[0.99]"
          >
            {hasApplyPhone && !hasApplyEmail ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor">
                <path d="M12.04 2A9.93 9.93 0 0 0 3.5 17.03L2 22l5.1-1.47A10 10 0 1 0 12.04 2Zm0 18.2a8.16 8.16 0 0 1-4.16-1.14l-.3-.18-3.02.87.89-2.94-.2-.31a8.2 8.2 0 1 1 6.79 3.7Zm4.5-6.14c-.25-.13-1.48-.73-1.71-.81-.23-.08-.4-.13-.56.13-.17.25-.65.81-.8.98-.15.17-.3.19-.55.06-.25-.13-1.06-.39-2.02-1.24-.75-.66-1.25-1.48-1.4-1.73-.15-.25-.02-.39.11-.52.11-.11.25-.3.38-.44.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.36-.77-1.86-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.09s.9 2.43 1.02 2.6c.13.17 1.77 2.71 4.28 3.8.6.26 1.07.41 1.44.52.61.19 1.17.16 1.61.1.49-.07 1.48-.61 1.69-1.2.21-.59.21-1.09.15-1.2-.06-.11-.23-.17-.48-.29Z" />
              </svg>
            ) : <span aria-hidden>{hasApplyEmail ? '✉' : '↗'}</span>}
            <span className="min-w-0 break-words">{applyLabel}</span>
          </button>
        </div>
      )}

      {unlocked && (
        <div className="border-t border-[#eef1f8] px-4 py-3 text-sm text-slate-700">
          Company: <span className="font-semibold text-slate-900">{job.company}</span>
          {job.manager ? <> · Manager: <span className="font-semibold text-slate-900">{job.manager}</span></> : null}
          {job.contact ? <> · Contact: <span className="font-semibold text-slate-900">{job.contact}</span></> : null}
          {job.managerAltPhone ? <> · <span className="font-extrabold text-brand-700">+91</span> <span className="font-semibold text-slate-900">{normalizeIndianMobile(job.managerAltPhone)}</span></> : null}
        </div>
      )}

      {showUnlockButton && (
        <div className="border-t border-[#eef1f8] px-4 py-3">
          <button
            type="button"
            disabled={unlockStage !== null}
            onClick={() => onWatchUnlock?.(job)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-3 py-3 text-sm font-bold text-white transition hover:bg-slate-800 active:scale-[0.99] disabled:opacity-60"
          >
            <span aria-hidden>🎬</span>
            {unlockButtonLabel(unlockStage)}
          </button>
        </div>
      )}
    </Card>
  )
}
