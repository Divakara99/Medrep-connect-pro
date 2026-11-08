import { useMemo, useState } from 'react'
import type { UnlockStage } from '../data/adConfig'
import { Badge, Button, Card, EmptyState } from '../components/ui'
import { JobCard } from '../components/JobCard'
import { CATEGORIES, filterJobs, sortedJobs, type Job, type JobCategory } from '../data/jobs'
import { isSubscribed, type User } from '../data/auth'

export function PriorityScreen({ user, jobs, onOpenJob, onWatchUnlock, unlockingJobId, unlockStage }: { user: User; jobs: Job[]; onOpenJob: (j: Job) => void; onWatchUnlock?: (j: Job) => void; unlockingJobId?: string | null; unlockStage?: UnlockStage | null }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<JobCategory>('All')
  const unlocked = isSubscribed(user)

  const pinned = useMemo(() => sortedJobs(jobs.filter((j) => j.pinned)), [jobs])
  const rest = useMemo(
    () => sortedJobs(filterJobs(jobs.filter((j) => !j.pinned), { query, category })),
    [jobs, query, category],
  )

  function clearFilters() {
    setQuery(''); setCategory('All')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 pb-8 pt-4">
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500 px-5 py-5 text-slate-900 shadow-[0_26px_55px_-32px_rgba(217,119,6,0.95)]">
        <div aria-hidden className="pointer-events-none absolute -right-14 -top-16 h-48 w-48 rounded-full bg-white/30 blur-2xl" />
        <div className="relative flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/60 text-2xl ring-1 ring-white/70">⭐</div>
          <div>
            <div className="text-lg font-extrabold tracking-tight">Priority jobs</div>
            <p className="mt-0.5 max-w-md text-sm font-semibold text-amber-950/80">
              Pinned by the admin — urgent MR and ABM openings appear first, before everything else.
            </p>
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold text-amber-950 ring-1 ring-white/60">
            📌 {pinned.length} pinned
          </span>
          <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold text-amber-950 ring-1 ring-white/60">
            {jobs.length} live jobs
          </span>
        </div>
      </section>

      <div className="rounded-3xl border border-slate-200/80 bg-white/95 p-2 shadow-[0_18px_44px_-32px_rgba(15,23,42,0.6)]">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.2-3.2" />
            </svg>
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search priority and other jobs…"
            aria-label="Search priority jobs"
            className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-base font-medium text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Pinned */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900">📌 Pinned by admin</h2>
          <Badge color="amber">{pinned.length}</Badge>
        </div>
        <div className="space-y-3">
          {pinned.length === 0 ? (
            <Card className="p-2">
              <EmptyState icon="📭" title="No pinned jobs yet" subtitle="Urgent roles appear here the moment the admin pins them." />
            </Card>
          ) : (
            pinned.map((j) => <JobCard key={j.id} job={j} unlocked={unlocked} onClick={() => onOpenJob(j)} onWatchUnlock={onWatchUnlock} unlockStage={unlockingJobId === j.id ? unlockStage : null} />)
          )}
        </div>
      </div>

      {/* Category filters */}
      <div>
        <h2 className="mb-2 text-lg font-extrabold tracking-tight text-slate-900">Browse by category</h2>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {CATEGORIES.map((c) => {
            const active = category === c
            return (
              <button
                key={c}
                onClick={() => setCategory(c)}
                aria-pressed={active}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${
                  active
                    ? 'bg-gradient-to-b from-brand-500 to-brand-700 text-white shadow-[0_10px_22px_-14px_rgba(29,78,216,0.95)] ring-1 ring-brand-700/30'
                    : 'bg-white/90 text-slate-700 ring-1 ring-slate-200 hover:bg-white hover:ring-slate-300'
                }`}
              >
                {c}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-3">
        {rest.length === 0 ? (
          <Card className="p-6">
            <EmptyState icon="🔎" title="No jobs match this filter" subtitle="Try another category or clear the search." />
            <div className="flex justify-center"><Button variant="secondary" onClick={clearFilters}>Clear</Button></div>
          </Card>
        ) : (
          rest.map((j) => <JobCard key={j.id} job={j} unlocked={unlocked} onClick={() => onOpenJob(j)} onWatchUnlock={onWatchUnlock} unlockStage={unlockingJobId === j.id ? unlockStage : null} />)
        )}
      </div>
    </div>
  )
}
