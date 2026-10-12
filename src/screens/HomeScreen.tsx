import { useMemo, useState } from 'react'
import { Badge, Button, Card, Input, Select } from '../components/ui'
import { CreatorCredit } from '../components/CreatorCredit'
import { JobCard } from '../components/JobCard'
import { CATEGORIES, filterJobs, jobStats, sortedJobs, type Job, type JobCategory } from '../data/jobs'
import type { User } from '../data/auth'
import { isSubscribed } from '../data/auth'

const EXP_OPTIONS = ['All', 'Fresher', '0–2 years', '2–5 years', '5+ years']
const SALARY_OPTIONS = ['All', 'Under ₹2 LPA', '₹2–4 LPA', '₹4–7 LPA', '₹7–12 LPA', '₹12 LPA+']

export function HomeScreen({
  user,
  jobs,
  onOpenJob,
  onGoPlans,
}: {
  user: User
  jobs: Job[]
  onOpenJob: (j: Job) => void
  onGoPlans: () => void
}) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [category, setCategory] = useState<JobCategory>('All')
  const [experience, setExperience] = useState('All')
  const [salary, setSalary] = useState('All')
  const [showFilters, setShowFilters] = useState(false)
  const unlocked = isSubscribed(user)

  const stats = useMemo(() => jobStats(jobs), [jobs])

  const list = useMemo(() => {
    let filtered = filterJobs(jobs, { query, category, location })
    if (experience !== 'All') {
      filtered = filtered.filter((j) => {
        const e = (j.experience || '').toLowerCase()
        if (experience === 'Fresher') return e.includes('fresher') || e.includes('0')
        if (experience === '0–2 years') return /0|1|2/.test(e) && !e.includes('5')
        if (experience === '2–5 years') return /2|3|4|5/.test(e)
        if (experience === '5+ years') return /[5-9]|10/.test(e)
        return true
      })
    }
    if (salary !== 'All') {
      filtered = filtered.filter((j) => {
        const s = j.salary || ''
        // crude LPA-based parse
        const nums = s.replace(/[^\d.\-–]/g, '').split(/[-–]/).map(Number).filter((n) => !isNaN(n))
        if (nums.length === 0) return false
        const min = Math.min(...nums)
        const max = Math.max(...nums)
        if (salary === 'Under ₹2 LPA') return max < 2
        if (salary === '₹2–4 LPA') return max >= 2 && min < 4
        if (salary === '₹4–7 LPA') return max >= 4 && min < 7
        if (salary === '₹7–12 LPA') return max >= 7 && min < 12
        if (salary === '₹12 LPA+') return max >= 12
        return true
      })
    }
    return sortedJobs(filtered)
  }, [jobs, query, category, location, experience, salary])

  function clearFilters() {
    setQuery(''); setLocation(''); setCategory('All'); setExperience('All'); setSalary('All')
  }

  const activeFilterCount =
    (category !== 'All' ? 1 : 0) +
    (experience !== 'All' ? 1 : 0) +
    (salary !== 'All' ? 1 : 0) +
    (location.trim() ? 1 : 0)

  return (
    <div className="max-w-3xl mx-auto px-4 pb-28 pt-4 space-y-4">
      {/* Hero — minimized creator pill */}
      <Card className="p-4 bg-gradient-to-br from-brand-600 to-brand-800 text-white border-0 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/5 blur-2xl" />
        <div className="flex items-center justify-between gap-2 relative flex-wrap">
          <div className="text-[10px] font-bold uppercase tracking-widest text-brand-100">India's 1st Pharma-Job Network</div>
          <CreatorCredit variant="dark" size="sm" />
        </div>
        <h1 className="text-xl sm:text-2xl font-extrabold mt-1 leading-tight">
          Hello, {user.name.split(' ')[0]} 👋<br />
          Find your next MR / ABM role.
        </h1>
        <p className="text-xs sm:text-sm text-brand-100/90 mt-1">MR vacancies pinned first — plus multi-industry jobs across India.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/10 p-2.5 ring-1 ring-white/20">
            <div className="text-lg font-extrabold">{stats.total}</div>
            <div className="text-[9px] uppercase tracking-wide text-brand-100">Live jobs</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5 ring-1 ring-white/20">
            <div className="text-lg font-extrabold">{stats.mr}</div>
            <div className="text-[9px] uppercase tracking-wide text-brand-100">MR roles</div>
          </div>
          <div className="rounded-xl bg-white/10 p-2.5 ring-1 ring-white/20">
            <div className="text-lg font-extrabold">{stats.pinned}</div>
            <div className="text-[9px] uppercase tracking-wide text-brand-100">Pinned</div>
          </div>
        </div>
        {!unlocked && (
          <Button variant="accent" className="mt-3 w-full py-2 text-sm" onClick={onGoPlans}>
            💎 Unlock jobs · Subscribe now
          </Button>
        )}
      </Card>

      {/* Search */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            className="min-w-0 flex-1"
            placeholder="Search job title, company, skill…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button variant="secondary" className="shrink-0" onClick={() => setShowFilters((v) => !v)}>
            🎛 Filters{activeFilterCount > 0 && <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-600 text-white text-[10px] font-bold">{activeFilterCount}</span>}
          </Button>
        </div>
        {showFilters && (
          <Card className="p-3 space-y-2 animate-fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Input placeholder="Location (city)" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
              <div>
                <Select value={category} onChange={(e) => setCategory(e.target.value as JobCategory)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
              <div>
                <Select value={experience} onChange={(e) => setExperience(e.target.value)}>
                  {EXP_OPTIONS.map((e) => <option key={e} value={e}>Exp: {e}</option>)}
                </Select>
              </div>
              <div>
                <Select value={salary} onChange={(e) => setSalary(e.target.value)}>
                  {SALARY_OPTIONS.map((s) => <option key={s} value={s}>Salary: {s}</option>)}
                </Select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={clearFilters}>Clear all</Button>
            </div>
          </Card>
        )}
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
        {CATEGORIES.map((c) => {
          const active = category === c
          return (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                active
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {c === 'MR' && '💊 '}
              {c === 'ABM' && '🎯 '}
              {c === 'All' && '🌐 '}
              {c}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900">
          {category === 'All' ? 'MR-first feed' : `${category} jobs`}
        </h2>
        <Badge color="brand">{list.length} roles</Badge>
      </div>

      <div className="space-y-3">
        {list.length === 0 ? (
          <Card className="p-8 text-center text-sm text-slate-500">
            {jobs.length === 0 ? 'No vacancies published yet. Please check back later.' : 'No jobs match your filters.'}
            <div className="mt-2">
              <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
            </div>
          </Card>
        ) : (
          list.map((j) => <JobCard key={j.id} job={j} unlocked={unlocked} onClick={() => onOpenJob(j)} />)
        )}
      </div>
    </div>
  )
}
