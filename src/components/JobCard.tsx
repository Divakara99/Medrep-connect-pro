import { Badge, Card } from './ui'
import { descriptionPoints, type Job } from '../data/jobs'
import { normalizeIndianMobile } from '../data/vacancyRules'

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
  unlockBusy = false,
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
  unlockBusy?: boolean
}) {
  // Per-job company unlock, kept separate from `unlocked`: it reveals the
  // company name only, never the four contact fields or Apply.
  const companyUnlocked = unlocked || job.companyUnlocked === true
  const showUnlockButton = !unlocked && job.companyUnlocked !== true && Boolean(onWatchUnlock)
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
    <Card className="p-4 cursor-pointer hover:shadow-md transition active:scale-[0.995]">
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white grid place-items-center font-bold text-sm shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-semibold text-slate-900 truncate">{job.title}</div>
              {job.pinned && <Badge color="amber">★ Pinned</Badge>}
            </div>

            {/* The city is always visible — before and after subscribing. */}
            <div className="text-sm text-slate-700 truncate flex items-center gap-1">
              <span aria-hidden>📍</span>
              <span className="font-semibold text-slate-800">{job.location}</span>
            </div>

            {companyUnlocked && job.company ? (
              <div className="text-sm text-slate-600 truncate mt-0.5">{job.company}</div>
            ) : (
              /* Locked placeholder: the real company name is never sent to a
                 free user, so there is nothing behind this blur. */
              <div className="mt-0.5 flex items-center gap-1.5">
                <span aria-hidden className="text-xs">🔒</span>
                <span className="text-sm font-bold text-slate-400 blur-[5px] select-none" aria-hidden>Hidden Pharma Pvt Ltd</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Locked</span>
              </div>
            )}

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge color={categoryColor[job.category] ?? 'slate'}>{job.category}</Badge>
              {job.salary && <Badge color="green">{job.salary}</Badge>}
              {job.experience && <span className="text-xs text-slate-500">{job.experience}</span>}
            </div>

            {preview.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {preview.map((point, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-sm text-slate-700 leading-snug">
                    <span aria-hidden className="text-brand-600 font-extrabold shrink-0">•</span>
                    <span className="line-clamp-1">{point}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-sm text-slate-600">Tap to view full details.</div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="text-[11px] text-slate-400">
                {timeAgo(job.postedAt)}
                {postedOn(job.postedAt) ? ` · ${postedOn(job.postedAt)}` : ''}
              </div>
              {unlocked ? (
                <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full ring-1 ring-emerald-200">
                  ✓ Unlocked
                </div>
              ) : companyUnlocked ? (
                <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full ring-1 ring-emerald-200">
                  ✓ Company unlocked · subscribe for contacts
                </div>
              ) : (
                <div className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded-full ring-1 ring-amber-200">
                  🔒 Subscribe to unlock
                </div>
              )}
            </div>

            {unlocked && (
              <div className="mt-2 text-xs text-slate-600">
                Company: <span className="font-semibold text-slate-800">{job.company}</span>
                {job.manager ? <> · Manager: <span className="font-semibold text-slate-800">{job.manager}</span></> : null}
                {job.contact ? <> · Contact: <span className="font-semibold text-slate-800">{job.contact}</span></> : null}
                {job.managerAltPhone ? <> · <span className="text-brand-700 font-extrabold">+91</span> <span className="font-semibold text-slate-800">{normalizeIndianMobile(job.managerAltPhone)}</span></> : null}
              </div>
            )}
          </div>
        </div>
      </button>
      {showUnlockButton && (
        <button
          type="button"
          disabled={unlockBusy}
          onClick={() => onWatchUnlock?.(job)}
          className="mt-3 w-full rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-60"
        >
          {unlockBusy ? '⏳ Checking your unlock…' : '▶ Watch video to unlock company name'}
        </button>
      )}
    </Card>
  )
}
