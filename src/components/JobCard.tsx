import { Badge, Card } from './ui'
import { unlockButtonLabel, type UnlockStage } from '../data/adConfig'
import { descriptionPoints, type Job } from '../data/jobs'
import { normalizeIndianMobile } from '../data/vacancyRules'
import { useUnlockWindow } from './useUnlockWindow'

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const h = Math.floor(d / 3600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}

function postedOn(ts: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function JobCard({
  job,
  unlocked,
  onClick,
  onWatchUnlock,
  unlockStage = null,
}: {
  job: Job
  /** Subscription flag ONLY — never set this from a company unlock. */
  unlocked: boolean
  onClick?: () => void
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
  const showUnlockButton = !unlocked && !unlockWindow.active && Boolean(onWatchUnlock)
  const categoryColor: Record<string, 'brand' | 'amber' | 'green' | 'purple' | 'red' | 'slate'> = {
    MR: 'brand',
    ABM: 'purple',
    Healthcare: 'green',
    FMCG: 'amber',
    'Part-time': 'slate',
    'E-commerce': 'amber',
    Finance: 'green',
    Banking: 'green',
    IT: 'purple',
    Insurance: 'red',
    Field: 'slate',
  }

  const initials = companyUnlocked && job.company ? job.company.slice(0, 2).toUpperCase() : '🔒'
  const preview = descriptionPoints(job.description).slice(0, 2)

  return (
    <Card className={`lift group relative overflow-hidden ${job.pinned ? 'ring-1 ring-amber-200' : ''}`}>
      {job.pinned && <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-300 via-amber-400 to-orange-400" />}
      <button onClick={onClick} className="w-full p-4 text-left">
        <div className="flex items-start gap-3">
          <div
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-sm font-extrabold text-white shadow-[0_10px_22px_-14px_rgba(29,78,216,0.95)] ring-1 ring-white/40 ${
              companyUnlocked
                ? 'bg-gradient-to-br from-brand-500 to-indigo-700'
                : 'bg-gradient-to-br from-slate-300 to-slate-400'
            }`}
          >
            {initials}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[17px] font-bold leading-snug tracking-tight text-slate-900 group-hover:text-brand-800">
                  {job.title}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-sm text-slate-700">
                  <span aria-hidden className="text-brand-600">📍</span>
                  <span className="truncate font-semibold">{job.location}</span>
                </div>
              </div>
              {job.pinned && <Badge color="amber">★ Pinned</Badge>}
            </div>

            {companyUnlocked && job.company ? (
              <div className="mt-0.5 truncate text-sm font-medium text-slate-600">{job.company}</div>
            ) : (
              /* Locked placeholder: the real company name is never sent to a
                 free user, so there is nothing behind this blur. */
              <div className="mt-1 flex items-center gap-1.5">
                <span aria-hidden className="text-xs">🔒</span>
                <span aria-hidden className="select-none text-sm font-bold text-slate-400 blur-[5px]">Hidden Pharma Pvt Ltd</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">Locked</span>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge color={categoryColor[job.category] ?? 'slate'}>{job.category}</Badge>
              {job.salary && <Badge color="green">{job.salary}</Badge>}
              {job.experience && <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">{job.experience}</span>}
            </div>
          </div>
        </div>

        {preview.length > 0 ? (
          <ul className="mt-3 space-y-1 rounded-2xl bg-slate-50/80 px-3 py-2.5 ring-1 ring-slate-100">
            {preview.map((point, index) => (
              <li key={index} className="flex items-start gap-1.5 text-sm leading-snug text-slate-700">
                <span aria-hidden className="shrink-0 font-extrabold text-brand-600">•</span>
                <span className="line-clamp-1">{point}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 rounded-2xl bg-slate-50/80 px-3 py-2.5 text-sm text-slate-600 ring-1 ring-slate-100">
            Tap to view full details.
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-slate-500">
            {timeAgo(job.postedAt)}
            {postedOn(job.postedAt) ? ` · ${postedOn(job.postedAt)}` : ''}
          </div>
          {unlocked ? (
            <div className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
              ✓ Unlocked
            </div>
          ) : companyUnlocked ? (
            <div className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
              ✓ Company unlocked · {unlockWindow.label} left
            </div>
          ) : (
            <div className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">
              🔒 Contact locked
            </div>
          )}
        </div>

        {unlocked && (
          <div className="mt-3 rounded-2xl bg-brand-50/70 px-3 py-2 text-xs text-slate-700 ring-1 ring-brand-100">
            Company: <span className="font-semibold text-slate-900">{job.company}</span>
            {job.manager ? <> · Manager: <span className="font-semibold text-slate-900">{job.manager}</span></> : null}
            {job.contact ? <> · Contact: <span className="font-semibold text-slate-900">{job.contact}</span></> : null}
            {job.managerAltPhone ? <> · <span className="font-extrabold text-brand-700">+91</span> <span className="font-semibold text-slate-900">{normalizeIndianMobile(job.managerAltPhone)}</span></> : null}
          </div>
        )}
      </button>

      {showUnlockButton && (
        <div className="px-4 pb-4">
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
