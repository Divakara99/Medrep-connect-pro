import { useMemo, useState } from 'react'
import { Badge, Button, Card, EmptyState, Input } from '../components/ui'
import { JobCard } from '../components/JobCard'
import { CATEGORIES, filterJobs, sortedJobs, type Job, type JobCategory } from '../data/jobs'
import { isSubscribed, type User } from '../data/auth'

export function PriorityScreen({ user, jobs, onOpenJob }: { user: User; jobs: Job[]; onOpenJob: (j: Job) => void }) {
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
    <div className="max-w-3xl mx-auto px-4 pb-6 pt-4 space-y-4">
      <Card className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
        <div className="flex items-start gap-3">
          <div className="text-2xl sm:text-3xl">⭐</div>
          <div>
            <div className="font-bold text-amber-900">Priority jobs</div>
            <div className="text-sm text-amber-800">Pinned by admin — urgent MR and ABM openings appear first.</div>
          </div>
        </div>
      </Card>

      <div className="flex gap-2">
        <Input className="min-w-0 flex-1" placeholder="Search priority & other jobs…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {/* Pinned */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-bold text-slate-900">📌 Pinned</h2>
          <Badge color="amber">{pinned.length}</Badge>
        </div>
        <div className="space-y-3">
          {pinned.length === 0 ? (
            <EmptyState icon="📭" title="No pinned jobs yet" subtitle="Admin will pin urgent roles here." />
          ) : (
            pinned.map((j) => <JobCard key={j.id} job={j} unlocked={unlocked} onClick={() => onOpenJob(j)} />)
          )}
        </div>
      </div>

      {/* Category filters */}
      <div>
        <h2 className="text-base font-bold text-slate-900 mb-2">Browse by category</h2>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
          {CATEGORIES.map((c) => {
            const active = category === c
            return (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
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
          <Card className="p-8 text-center text-sm text-slate-500">
            No jobs match your filter.
            <div className="mt-2"><Button variant="secondary" onClick={clearFilters}>Clear</Button></div>
          </Card>
        ) : (
          rest.map((j) => <JobCard key={j.id} job={j} unlocked={unlocked} onClick={() => onOpenJob(j)} />)
        )}
      </div>
    </div>
  )
}
