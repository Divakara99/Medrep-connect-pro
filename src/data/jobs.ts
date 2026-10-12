import { read, remove, write } from './storage'
import { supabase } from './supabase'
import { broadcast } from './notifications'

export type JobCategory =
  | 'MR' | 'ABM' | 'Part-time' | 'E-commerce' | 'Finance' | 'Banking'
  | 'IT' | 'Healthcare' | 'Insurance' | 'FMCG' | 'Field' | 'All'

export const CATEGORIES: JobCategory[] = [
  'All', 'MR', 'ABM', 'Part-time', 'E-commerce', 'Finance', 'Banking',
  'IT', 'Healthcare', 'Insurance', 'FMCG', 'Field',
]

export const CATEGORY_PRIORITY: Record<JobCategory, number> = {
  MR: 0, ABM: 1, Healthcare: 2, Field: 3, FMCG: 4,
  'Part-time': 5, 'E-commerce': 6, Finance: 7, Banking: 8,
  IT: 9, Insurance: 10, All: 99,
}

export type Job = {
  id: string
  title: string
  // These fields are returned by list_visible_jobs ONLY while subscribed.
  company: string
  manager?: string
  contact?: string
  managerAltPhone?: string // optional manager alternative number, shown with a (+) sign
  managerEmail?: string
  location: string
  hq?: string
  division?: string
  category: Exclude<JobCategory, 'All'>
  salary?: string
  experience?: string
  description?: string
  pinned?: boolean
  postedAt: number
  postedBy?: string
}

const LEGACY_JOBS_KEY = 'mrc_jobs_v1'
let jobs: Job[] = []
let generation = 0

export function getJobs(): Job[] { return jobs }
export function clearJobs(): void { ++generation; jobs = [] }
// Old browser data was never access-controlled. Purge it on user login; on
// an admin device it can instead be explicitly reviewed and imported once.
export function purgeLegacyJobs(): void {
  remove(LEGACY_JOBS_KEY)
  // Old local job alerts could include company names. Keep other notices but
  // purge those historic alerts when a normal user signs in.
  const notifications = read<unknown>('mrc_notifications_v1', [])
  if (Array.isArray(notifications)) {
    write('mrc_notifications_v1', notifications.filter((notice) =>
      notice && typeof notice === 'object' && notice.type !== 'job',
    ))
  }
}
export function getLegacyJobs(): Job[] {
  const saved = read<unknown>(LEGACY_JOBS_KEY, [])
  if (!Array.isArray(saved)) return []
  return saved.filter((job): job is Job =>
    job !== null && typeof job === 'object'
      && typeof job.id === 'string' && typeof job.title === 'string'
      && typeof job.company === 'string' && typeof job.location === 'string'
      && typeof job.category === 'string' && job.deleted !== true,
  )
}

function parseJob(value: unknown): Job | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.title !== 'string'
    || typeof row.location !== 'string' || typeof row.category !== 'string') return null
  return {
    id: row.id,
    title: row.title,
    company: typeof row.company === 'string' ? row.company : '',
    manager: typeof row.manager === 'string' ? row.manager : undefined,
    contact: typeof row.contact === 'string' ? row.contact : undefined,
    managerAltPhone: typeof row.managerAltPhone === 'string' ? row.managerAltPhone : undefined,
    managerEmail: typeof row.managerEmail === 'string' ? row.managerEmail : undefined,
    description: typeof row.description === 'string' ? row.description : undefined,
    location: row.location,
    hq: typeof row.hq === 'string' ? row.hq : undefined,
    division: typeof row.division === 'string' ? row.division : undefined,
    category: row.category as Job['category'],
    salary: typeof row.salary === 'string' ? row.salary : undefined,
    experience: typeof row.experience === 'string' ? row.experience : undefined,
    pinned: row.pinned === true,
    postedAt: typeof row.postedAt === 'number' ? row.postedAt : 0,
  }
}

export async function loadVisibleJobs(): Promise<Job[]> {
  const request = generation
  const { data, error } = await supabase.rpc('list_visible_jobs')
  if (error) throw new Error('Jobs are temporarily unavailable. Please try again later or contact support.')
  const result = (Array.isArray(data) ? data : []).map(parseJob).filter((job): job is Job => job !== null)
  if (generation === request) jobs = result
  return result
}

export async function loadAdminJobs(): Promise<Job[]> {
  const request = generation
  const { data, error } = await supabase.from('vacancies').select('id,data').order('synced_at', { ascending: false }).limit(500)
  if (error) throw new Error('Cannot load vacancies. Verify the admin role and run schema.sql.')
  const result = ((data ?? []) as { id: string; data: unknown }[])
    .filter((row) => (row.data as { deleted?: boolean })?.deleted !== true)
    .map((row) => parseJob({ ...(row.data as Record<string, unknown>), id: row.id }))
    .filter((job): job is Job => job !== null)
  if (generation === request) jobs = result
  return result
}

async function storeJob(job: Job): Promise<void> {
  const { error } = await supabase.from('vacancies').upsert({
    id: job.id,
    data: job,
    synced_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (error) throw new Error('Vacancy could not be saved. Check administrator permissions and try again.')
}

export async function importLegacyJobs(): Promise<number> {
  const legacy = getLegacyJobs()
  for (const job of legacy) await storeJob(job)
  purgeLegacyJobs()
  await loadAdminJobs()
  return legacy.length
}

export async function addJob(input: Omit<Job, 'id' | 'postedAt'>): Promise<Job> {
  const job: Job = { ...input, id: crypto.randomUUID(), postedAt: Date.now() }
  await storeJob(job)
  jobs = [job, ...jobs]
  // Every new job post must notify users.
  broadcast({
    kind: 'job-posted',
    jobTitle: job.title,
    category: job.category,
    location: job.location,
    pinned: job.pinned,
  }, { meta: { jobId: job.id } })
  return job
}

const CONTENT_FIELDS: (keyof Job)[] = [
  'title', 'company', 'manager', 'contact', 'managerAltPhone', 'managerEmail',
  'location', 'hq', 'division', 'category', 'salary', 'experience', 'description',
]

export async function updateJob(id: string, patch: Partial<Job>, options?: { silent?: boolean }): Promise<Job> {
  const previous = jobs.find((job) => job.id === id)
  if (!previous) throw new Error('Reload vacancies and try again.')
  const updated = { ...previous, ...patch, id }
  await storeJob(updated)
  jobs = jobs.map((job) => job.id === id ? updated : job)
  // Every real job update must notify users (silent is reserved for housekeeping
  // such as pin toggles, which are not content updates).
  const contentChanged = CONTENT_FIELDS.some((field) => updated[field] !== previous[field])
  if (!options?.silent && contentChanged) {
    broadcast({ kind: 'job-edited', jobTitle: updated.title }, { meta: { jobId: updated.id } })
  }
  return updated
}

export async function deleteJob(id: string): Promise<void> {
  // Tombstone rather than delete so a stale client cannot resurrect a row.
  const { error } = await supabase.from('vacancies').update({
    data: { deleted: true, deletedAt: Date.now() }, synced_at: new Date().toISOString(),
  }).eq('id', id).select('id').single()
  if (error) throw new Error('Vacancy could not be deleted. Check permissions and try again.')
  jobs = jobs.filter((job) => job.id !== id)
}

export async function togglePin(id: string, pinned: boolean): Promise<Job> {
  // Pinning is housekeeping, not a content update — do not spam notifications.
  return updateJob(id, { pinned }, { silent: true })
}

export function sortedJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const pa = CATEGORY_PRIORITY[a.category] ?? 50
    const pb = CATEGORY_PRIORITY[b.category] ?? 50
    if (pa !== pb) return pa - pb
    return b.postedAt - a.postedAt
  })
}

export function filterJobs(
  jobs: Job[],
  opts: { query?: string; category?: JobCategory; location?: string },
): Job[] {
  const q = opts.query?.trim().toLowerCase()
  const loc = opts.location?.trim().toLowerCase()
  return jobs.filter((j) => {
    if (opts.category && opts.category !== 'All' && j.category !== opts.category) return false
    if (q) {
      const hay = `${j.title} ${j.company ?? ''} ${j.category} ${j.description ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (loc && !j.location.toLowerCase().includes(loc)) return false
    return true
  })
}

export function jobStats(jobs: Job[]) {
  const total = jobs.length
  const mr = jobs.filter((j) => j.category === 'MR').length
  const pinned = jobs.filter((j) => j.pinned).length
  const other = total - mr
  return { total, mr, pinned, other }
}
