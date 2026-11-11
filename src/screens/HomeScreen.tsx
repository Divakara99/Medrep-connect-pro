import { useMemo, useState } from 'react'
import type { UnlockStage } from '../data/adConfig'
import { Badge, Button, Card, EmptyState, Select } from '../components/ui'
import { CreatorCredit } from '../components/CreatorCredit'
import { AboutPage } from './AboutPage'
import { JobCard } from '../components/JobCard'
import { CATEGORIES, cityOptions, filterJobs, hqOptions, jobStats, sortedJobs, type Job, type JobCategory } from '../data/jobs'
import type { User } from '../data/auth'
import { isSubscribed } from '../data/auth'
import { CREATOR } from '../data/creator'

const EXP_OPTIONS = ['All', 'Fresher', '0–2 years', '2–5 years', '5+ years']

export function HomeScreen({
  user,
  jobs,
  onOpenJob,
  onWatchUnlock,
  unlockingJobId,
  unlockStage,
}: {
  user: User
  jobs: Job[]
  onOpenJob: (j: Job) => void
  onWatchUnlock?: (j: Job) => void
  unlockingJobId?: string | null
  unlockStage?: UnlockStage | null
}) {
  const [query, setQuery] = useState('')
  const [city, setCity] = useState('All')
  const [hq, setHq] = useState('All')
  const [category, setCategory] = useState<JobCategory>('All')
  const [experience, setExperience] = useState('All')
  const [showFilters, setShowFilters] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const unlocked = isSubscribed(user)

  const stats = useMemo(() => jobStats(jobs), [jobs])
  const cities = useMemo(() => cityOptions(jobs), [jobs])
  const headquarters = useMemo(() => hqOptions(jobs), [jobs])

  const list = useMemo(() => {
    let filtered = filterJobs(jobs, {
      query,
      category,
      city: city === 'All' ? '' : city,
      hq: hq === 'All' ? '' : hq,
    })
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
    return sortedJobs(filtered)
  }, [jobs, query, category, experience, city, hq])

  function clearFilters() {
    setQuery(''); setCity('All'); setHq('All'); setCategory('All'); setExperience('All')
  }

  const activeFilterCount =
    (category !== 'All' ? 1 : 0) +
    (experience !== 'All' ? 1 : 0) +
    (city !== 'All' ? 1 : 0) +
    (hq !== 'All' ? 1 : 0)

  const firstName = user.name.trim().split(' ')[0] || 'there'

  if (aboutOpen) return <AboutPage onClose={() => setAboutOpen(false)} />

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 pb-8 pt-4">
      {/* Hero — one deep gradient block with the greeting, the live counts and
          the founder credit, so the first screen answers "what is this?" at a
          glance. No plan promotion here: the feed is about jobs. */}
      <section className="hero-mesh hairline relative overflow-hidden rounded-[28px] px-5 py-5 text-white shadow-[0_28px_60px_-34px_rgba(23,37,84,0.95)]">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full border border-white/15" />
        <div aria-hidden className="pointer-events-none absolute -right-6 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />

        <div className="relative flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/90 ring-1 ring-white/25">
            <span aria-hidden>✦</span> India&apos;s pharma job network
          </span>
          <CreatorCredit variant="dark" size="sm" />
        </div>

        <h1 className="relative mt-3 text-2xl font-extrabold leading-tight sm:text-3xl">
          Hi{' '}
          <span className="rounded-xl bg-amber-300 px-2 py-0.5 text-slate-900 shadow-sm">{firstName}</span>{' '}
          <span aria-hidden>👋</span>
        </h1>
        <p className="relative mt-1.5 max-w-md text-sm leading-relaxed text-white/80">
          MR and ABM roles come first, then genuine openings of every kind across India.
        </p>

        <div className="relative mt-4 grid grid-cols-3 gap-2">
          {[
            { value: stats.total, label: 'live jobs' },
            { value: stats.mr, label: 'MR roles' },
            { value: stats.pinned, label: 'pinned' },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl bg-white/10 px-3 py-2 ring-1 ring-white/20 backdrop-blur-sm">
              <div className="text-xl font-extrabold leading-none">{item.value}</div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-white/75">{item.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Search + filters live in one floating sheet. */}
      <div className="rounded-3xl border border-slate-200/80 bg-white/95 p-2 shadow-[0_18px_44px_-32px_rgba(15,23,42,0.6)]">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.2-3.2" />
            </svg>
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search role, company, city…"
            aria-label="Search vacancies"
            className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-base font-medium text-slate-900 outline-none placeholder:text-slate-400"
          />
          <Button
            variant={showFilters || activeFilterCount > 0 ? 'primary' : 'secondary'}
            className="shrink-0 px-3"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 5h16l-6.4 7.5V19l-3.2 1.6v-8.1L4 5Z" />
            </svg>
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-extrabold text-brand-700">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        {showFilters && (
          <div className="mt-2 space-y-3 border-t border-slate-100 px-1 pb-1 pt-3 animate-fade-in">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select aria-label="Filter by city" value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="All">City: All</option>
                {cities.map((c) => <option key={c} value={c}>City: {c}</option>)}
              </Select>
              <Select aria-label="Filter by HQ" value={hq} onChange={(e) => setHq(e.target.value)}>
                <option value="All">HQ: All</option>
                {headquarters.map((h) => <option key={h} value={h}>HQ: {h}</option>)}
              </Select>
              <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value as JobCategory)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>Category: {c}</option>)}
              </Select>
              <Select aria-label="Filter by experience" value={experience} onChange={(e) => setExperience(e.target.value)}>
                {EXP_OPTIONS.map((e) => <option key={e} value={e}>Exp: {e}</option>)}
              </Select>
            </div>
            {cities.length === 0 && headquarters.length === 0 && (
              <p className="px-1 text-xs font-semibold text-slate-500">
                City and HQ choices appear once vacancies are published.
              </p>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" className="px-3 py-1.5 text-sm" onClick={clearFilters}>Clear all</Button>
            </div>
          </div>
        )}
      </div>

      {/* Category chips */}
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
              {c === 'MR' && <span aria-hidden>💊 </span>}
              {c === 'ABM' && <span aria-hidden>🎯 </span>}
              {c === 'All' && <span aria-hidden>🌐 </span>}
              {c}
            </button>
          )
        })}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-extrabold leading-tight tracking-tight text-slate-900">
            {category === 'All' ? 'Apply to these jobs' : `${category} openings`}
          </h2>
          <p className="mt-0.5 text-sm font-medium italic text-slate-500">
            {category === 'All' ? `Top ${list.length} job${list.length === 1 ? '' : 's'} that match your profile` : 'Newest first'}
          </p>
        </div>
        <Badge color="brand">{list.length} roles</Badge>
      </div>

      <div className="space-y-4">
        {list.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              icon="🗂"
              title={jobs.length === 0 ? 'No vacancies published yet' : 'Nothing matches these filters'}
              subtitle={jobs.length === 0 ? 'New openings are posted every week — check back soon.' : 'Try a wider city, HQ, category or experience.'}
            />
            <div className="flex justify-center">
              <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
            </div>
          </Card>
        ) : (
          list.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              unlocked={unlocked}
              onClick={() => onOpenJob(j)}
              onWatchUnlock={onWatchUnlock}
              unlockStage={unlockingJobId === j.id ? unlockStage : null}
            />
          ))
        )}
      </div>

      {/* Founder credit — one quiet card at the end of the feed. */}
      <footer className="pt-2">
        <div className="rounded-3xl bg-white/80 px-4 py-4 text-center ring-1 ring-slate-200/80 backdrop-blur-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">App created by</div>
          <div className="mt-1 text-lg font-extrabold tracking-tight text-slate-900">Mr. {CREATOR.name}</div>
          <div className="text-sm font-semibold text-brand-700">{CREATOR.role}</div>
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="mt-2 text-xs font-bold text-brand-700 underline underline-offset-4"
          >
            Read more about the app
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-slate-500">MedRep Connect Pro · {CREATOR.tagline}</p>
      </footer>
    </div>
  )
}
