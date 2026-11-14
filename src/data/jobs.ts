import { read, remove } from './storage'
import { supabase } from './supabase'
import { broadcast, publish } from './notifications'
import { deleteReasonProblem } from './vacancyRules'
import { matchesCity, matchesHq } from './jobFilters'
import { cleanExtraFields, type ExtraField } from './extraFields'
import { parseFillCheck, type FillCheck } from './fillCheck'

export { EXTRA_FIELD_LIMIT, EXTRA_LABEL_MAX, EXTRA_VALUE_MAX, cleanExtraFields, extraFieldProblem } from './extraFields'
export type { ExtraField } from './extraFields'

export { cityOptions, hqOptions } from './jobFilters'

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
  /**
   * Company name. Returned by list_visible_jobs while subscribed, OR for a
   * job whose company this user unlocked with a rewarded video
   * (companyUnlocked). Deliberately separate from the subscription flag:
   * unlocking a company never unlocks the four contact fields, and never
   * enables Apply.
   */
  company: string
  companyUnlocked?: boolean
  /**
   * When the rewarded-video unlock lapses (ISO timestamp from the server).
   * The name is withdrawn after this moment; the app only mirrors the rule for
   * display — list_visible_jobs() is what actually decides.
   */
  unlockExpiresAt?: string | null
  /**
   * Paid ₹5 single-job unlock: the whole contact block for THIS vacancy for
   * 24 hours after server verification; older paid rows may remain permanent.
   * The app mirrors the server projection; it never decides access itself.
   */
  jobUnlocked?: boolean
  jobUnlockExpiresAt?: string | null
  manager?: string
  contact?: string
  managerAltPhone?: string // optional local 10-digit Indian mobile, shown with a +91 prefix
  managerEmail?: string
  location: string
  hq?: string
  division?: string
  category: Exclude<JobCategory, 'All'>
  salary?: string
  experience?: string
  qualification?: string
  ageLimit?: string
  vacancyCount?: string
  description?: string
  pinned?: boolean
  postedAt: number
  postedBy?: string
  /** Details beyond the fixed form, shown publicly on the vacancy. */
  extraFields?: ExtraField[]
  /** "Is this still open?" — the ask to the team and their answer. */
  fillCheck?: FillCheck
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
  // Notifications no longer live in the browser at all; delete the old feed,
  // which could contain company names, when a normal user signs in.
  remove('mrc_notifications_v1')
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
    companyUnlocked: row.companyUnlocked === true,
    unlockExpiresAt: typeof row.unlockExpiresAt === 'string' ? row.unlockExpiresAt : undefined,
    jobUnlocked: row.jobUnlocked === true,
    jobUnlockExpiresAt: typeof row.jobUnlockExpiresAt === 'string' ? row.jobUnlockExpiresAt : undefined,
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
    qualification: typeof row.qualification === 'string' ? row.qualification : undefined,
    ageLimit: typeof row.ageLimit === 'string' ? row.ageLimit : undefined,
    vacancyCount: typeof row.vacancyCount === 'string' ? row.vacancyCount : undefined,
    pinned: row.pinned === true,
    postedAt: typeof row.postedAt === 'number' ? row.postedAt : 0,
    extraFields: parseExtraFields(row.extraFields),
    fillCheck: parseFillCheck(row.fillCheck),
  }
}

/** Reads stored extra fields, dropping anything malformed or too long. */
function parseExtraFields(value: unknown): ExtraField[] | undefined {
  if (!Array.isArray(value)) return undefined
  const fields = cleanExtraFields(value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      label: typeof item.label === 'string' ? item.label : '',
      value: typeof item.value === 'string' ? item.value : '',
    })))
  return fields.length > 0 ? fields : undefined
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
  // Every new job post must notify users — in the app and on their phones.
  const notice = broadcast({
    kind: 'job-posted',
    jobTitle: job.title,
    category: job.category,
    location: job.location,
    pinned: job.pinned,
  }, { meta: { jobId: job.id } })
  void publish(notice)
  return job
}

const CONTENT_FIELDS: (keyof Job)[] = [
  'title', 'company', 'manager', 'contact', 'managerAltPhone', 'managerEmail',
  'location', 'hq', 'division', 'category', 'salary', 'experience', 'qualification', 'ageLimit', 'vacancyCount', 'description',
  'extraFields',
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
    const notice = broadcast({ kind: 'job-edited', jobTitle: updated.title }, { meta: { jobId: updated.id } })
    void publish(notice)
  }
  return updated
}

export async function deleteJob(id: string, reason: string): Promise<void> {
  // Every deletion needs a reason; the audit log keeps it with the vacancy.
  const problem = deleteReasonProblem(reason)
  if (problem) throw new Error(problem)
  if (!id) throw new Error('Choose the vacancy to delete and try again.')
  // Only a vacancy this admin can actually see may be deleted, so a stale id
  // can never reach the database.
  const previous = jobs.find((job) => job.id === id)
  if (!previous) throw new Error('That vacancy is not in the current list. Reload and try again.')
  // Tombstone rather than delete so a stale client cannot resurrect a row. The
  // rest of the row is kept: the activity log stays readable and a restored
  // vacancy comes back whole.
  const { data, error } = await supabase.from('vacancies').update({
    data: { ...previous, id, deleted: true, deletedAt: Date.now(), deleteReason: reason.trim() },
    synced_at: new Date().toISOString(),
  }).eq('id', id).select('id')
  if (error) throw new Error('Vacancy could not be deleted. Check permissions and try again.')
  // The update is scoped to one primary key, so exactly one row must come back.
  // Anything else is reported instead of silently hiding the list.
  const changed = Array.isArray(data) ? data.length : 0
  if (changed !== 1) {
    throw new Error(changed === 0
      ? 'That vacancy no longer exists. Reload the list to see the current vacancies.'
      : `The database changed ${changed} rows for a single delete. No other vacancy was removed here — reload and check the list before deleting again.`)
  }
  jobs = jobs.filter((job) => job.id !== id)
}

/**
 * What the admin needs to see in the bin: enough to recognise the vacancy, to
 * read it before deciding, and to know whether it can come back at all.
 *
 * A tombstone written before `vacancy_restore.sql` kept only the id, the time
 * and the reason — nothing to restore. Those rows are listed and labelled, and
 * the title/company/location/category are filled in from the activity log so
 * the admin can still recognise what was deleted and post it again.
 */
export type DeletedVacancy = {
  id: string
  title: string
  company: string
  location: string
  category: string
  salary?: string
  experience?: string
  qualification?: string
  ageLimit?: string
  vacancyCount?: string
  description?: string
  postedAt: number
  deletedAt: number
  deletedBy: string
  deleteReason: string
  /** True only when the tombstone still carries the vacancy, so it can return. */
  recoverable: boolean
  /** True when title and friends came from the activity log, not the row. */
  detailsFromAudit: boolean
}

type DeletedRow = { id: string; data: unknown }
type AuditSnapshot = { title: string; company: string; location: string; category: string }

/**
 * The last thing the activity log knows about each deleted vacancy. Used only
 * for tombstones that lost their body, so the bin is never a list of blank
 * cards.
 */
async function auditSnapshots(): Promise<Map<string, AuditSnapshot>> {
  const snapshots = new Map<string, AuditSnapshot>()
  const { data, error } = await supabase
    .from('vacancy_audit')
    .select('vacancy_id,title,company,location,category,created_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return snapshots
  for (const row of (data ?? []) as { vacancy_id: string; title: string; company: string; location: string; category: string }[]) {
    const current = snapshots.get(row.vacancy_id)
    const next = {
      title: row.title ?? '',
      company: row.company ?? '',
      location: row.location ?? '',
      category: row.category ?? '',
    }
    // Newest first: keep the first row that actually carries a title.
    if (!current || (!current.title && next.title)) snapshots.set(row.vacancy_id, next)
  }
  return snapshots
}

export async function loadDeletedVacancies(): Promise<DeletedVacancy[]> {
  const { data, error } = await supabase
    .from('vacancies')
    .select('id,data')
    .order('synced_at', { ascending: false })
    .limit(500)
  if (error) throw new Error('Deleted vacancies could not be loaded.')
  const tombstones = ((data ?? []) as DeletedRow[]).filter((row) => (row.data as { deleted?: boolean } | null)?.deleted === true)
  if (tombstones.length === 0) return []

  let snapshots = new Map<string, AuditSnapshot>()
  try { snapshots = await auditSnapshots() } catch { /* the bin still lists what it has */ }

  return tombstones.map((row) => {
    const from = (row.data ?? {}) as Record<string, unknown>
    const text = (key: string) => (typeof from[key] === 'string' ? (from[key] as string) : '')
    const keptTitle = text('title').trim()
    const keptLocation = text('location').trim()
    const keptCategory = text('category').trim()
    // A restorable tombstone must carry the three fields a vacancy cannot live
    // without; anything less is an old delete.
    const recoverable = Boolean(keptTitle && keptLocation && keptCategory)
    const audit = snapshots.get(row.id)
    const detailsFromAudit = !keptTitle && Boolean(audit?.title)
    return {
      id: row.id,
      title: keptTitle || audit?.title || 'Deleted vacancy',
      company: text('company') || audit?.company || '',
      location: keptLocation || audit?.location || '',
      category: keptCategory || audit?.category || '',
      salary: text('salary') || undefined,
      experience: text('experience') || undefined,
      qualification: text('qualification') || undefined,
      ageLimit: text('ageLimit') || undefined,
      vacancyCount: text('vacancyCount') || undefined,
      description: text('description') || undefined,
      postedAt: typeof from.postedAt === 'number' ? from.postedAt : 0,
      deletedAt: typeof from.deletedAt === 'number' ? from.deletedAt : 0,
      deletedBy: text('deletedBy'),
      deleteReason: text('deleteReason'),
      recoverable,
      detailsFromAudit,
    }
  })
}

/**
 * Undo a delete: one server call (`restore_vacancy`), which clears the
 * tombstone, checks the caller's role, and writes a "restored" line to the
 * activity log. The older client-side update is kept as a fallback for a
 * database that has not had `vacancy_restore.sql` applied yet, so Undo still
 * works during a deployment.
 */
export async function restoreJob(id: string): Promise<string> {
  if (!id) throw new Error('Choose the vacancy to restore and try again.')

  const { data, error } = await supabase.rpc('restore_vacancy', { p_id: id })
  if (!error) {
    const payload = (data ?? {}) as { ok?: boolean; title?: string; error?: string }
    if (payload.error) throw new Error(payload.error)
    await loadAdminJobs().catch(() => undefined)
    return typeof payload.title === 'string' ? payload.title : ''
  }

  const missingFunction = error.code === 'PGRST202' || /restore_vacancy/.test(error.message || '')
  if (!missingFunction) throw new Error(error.message || 'The vacancy could not be restored. Try again.')

  // Fallback: the pre-migration path, scoped to one row and verified.
  const { data: row, error: readError } = await supabase
    .from('vacancies')
    .select('id,data')
    .eq('id', id)
    .maybeSingle()
  if (readError) throw new Error('That vacancy could not be read. Reload and try again.')
  if (!row) throw new Error('That vacancy no longer exists.')
  const previous = (row.data ?? {}) as Record<string, unknown>
  if (previous.deleted !== true) throw new Error('That vacancy is already live.')
  if (typeof previous.title !== 'string' || !previous.title.trim()
    || typeof previous.location !== 'string' || !previous.location.trim()
    || typeof previous.category !== 'string') {
    throw new Error('This vacancy was deleted before its details were kept, so it cannot be restored. Post it again instead.')
  }
  const restored: Record<string, unknown> = { ...previous }
  delete restored.deleted
  delete restored.deletedAt
  delete restored.deleteReason
  delete restored.deletedBy
  restored.restoredAt = Date.now()
  const { data: updated, error: updateError } = await supabase.from('vacancies').update({
    data: restored,
    synced_at: new Date().toISOString(),
  }).eq('id', id).select('id')
  if (updateError) throw new Error('The vacancy could not be restored. Check permissions and try again.')
  const changed = Array.isArray(updated) ? updated.length : 0
  if (changed !== 1) throw new Error(`The database changed ${changed} rows for one restore. Reload the list before trying again.`)
  await loadAdminJobs().catch(() => undefined)
  return typeof previous.title === 'string' ? previous.title : ''
}

/**
 * Writes the "is it still open?" state onto one vacancy.
 *
 * Not a content change, so no notification goes out and the public job
 * projection does not carry it: only the administrator's list and the vacancy
 * team's portal read `fillCheck`.
 */
export async function setFillCheck(id: string, patch: Partial<FillCheck> | null): Promise<void> {
  if (!id) throw new Error('Choose the vacancy and try again.')
  const { data: row, error: readError } = await supabase
    .from('vacancies')
    .select('id,data')
    .eq('id', id)
    .maybeSingle()
  if (readError) throw new Error('That vacancy could not be read. Reload and try again.')
  if (!row) throw new Error('That vacancy no longer exists.')
  const current = (row.data ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = { ...current }
  if (patch === null) {
    delete merged.fillCheck
  } else {
    merged.fillCheck = { ...(parseFillCheck(current.fillCheck) ?? {}), ...patch }
  }
  const { data, error } = await supabase.from('vacancies').update({
    data: merged,
    synced_at: new Date().toISOString(),
  }).eq('id', id).select('id')
  if (error) throw new Error('That vacancy could not be updated. Check permissions and try again.')
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error('The database did not update that vacancy. Reload the list and try again.')
  }
  const updated = parseJob({ ...merged, id })
  if (updated) jobs = jobs.map((job) => job.id === id ? updated : job)
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
  opts: { query?: string; category?: JobCategory; location?: string; city?: string; hq?: string },
): Job[] {
  const q = opts.query?.trim().toLowerCase()
  const loc = opts.location?.trim().toLowerCase()
  const city = opts.city?.trim().toLowerCase()
  const hq = opts.hq?.trim().toLowerCase()
  return jobs.filter((j) => {
    if (opts.category && opts.category !== 'All' && j.category !== opts.category) return false
    if (q) {
      const hay = `${j.title} ${j.company ?? ''} ${j.category} ${j.description ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (loc && !j.location.toLowerCase().includes(loc)) return false
    // A vacancy may name more than one working city or HQ, so match any entry.
    if (!matchesCity(j, city ?? '')) return false
    if (!matchesHq(j, hq ?? '')) return false
    return true
  })
}

export function descriptionPoints(description?: string): string[] {
  return (description || '')
    .split(/\r?\n|•/)
    .map((line) => line.replace(/^\s*(?:\(\+\)|[*•\u2022-])\s*/, '').trim())
    .filter(Boolean)
}

export function jobStats(jobs: Job[]) {
  const total = jobs.length
  const mr = jobs.filter((j) => j.category === 'MR').length
  const pinned = jobs.filter((j) => j.pinned).length
  const other = total - mr
  return { total, mr, pinned, other }
}
