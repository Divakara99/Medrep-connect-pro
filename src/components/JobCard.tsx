import { Badge, Card } from './ui'
import type { Job } from '../data/jobs'

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const h = Math.floor(d / 3600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}

export function JobCard({
  job,
  unlocked,
  onClick,
}: {
  job: Job
  unlocked: boolean
  onClick?: () => void
}) {
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

  const initials = unlocked ? job.company.slice(0, 2).toUpperCase() : '🔒'

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
            <div className="text-sm text-slate-600 truncate">
              {unlocked ? (
                <>
                  {job.company} · {job.location}
                </>
              ) : (
                <>
                  <span className="text-slate-600">Company hidden · {job.location}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge color={categoryColor[job.category] ?? 'slate'}>{job.category}</Badge>
              {job.salary && <Badge color="green">{job.salary}</Badge>}
              {job.experience && <span className="text-xs text-slate-500">{job.experience}</span>}
            </div>

            <div className="mt-3 text-sm text-slate-700 line-clamp-2">
              {job.description || 'Tap to view full details.'}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="text-[11px] text-slate-400">{timeAgo(job.postedAt)}</div>
              {!unlocked ? (
                <div className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded-full ring-1 ring-amber-200">
                  🔒 Subscribe to unlock
                </div>
              ) : (
                <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full ring-1 ring-emerald-200">
                  ✓ Unlocked
                </div>
              )}
            </div>


            {unlocked && (
              <div className="mt-2 text-xs text-slate-600">
                Company: <span className="font-semibold text-slate-800">{job.company}</span> · Manager: <span className="font-semibold text-slate-800">{job.manager}</span> · Contact: <span className="font-semibold text-slate-800">{job.contact}</span>
              </div>
            )}
          </div>
        </div>
      </button>
    </Card>
  )
}
