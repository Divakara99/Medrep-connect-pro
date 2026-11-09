import type { Job } from './jobs'

/**
 * Duplicate clean-up for the admin vacancies list.
 *
 * Kept in its own module, free of database imports, so the grouping rules are
 * unit-tested directly.
 */
/**
 * Two rows are duplicates only when every public field matches exactly (case
 * and spacing ignored), so two genuine openings at the same company and city
 * stay separate as long as their text differs. A group keeps one copy — the
 * pinned one, otherwise the oldest post — and lists the rest for removal.
 */
export type VacancyDuplicateGroup = {
  key: string
  keep: Job
  remove: Job[]
}

function duplicateKey(job: Job): string {
  const normalize = (value?: string) => (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  return [
    normalize(job.title),
    normalize(job.company),
    normalize(job.location),
    normalize(job.category),
    normalize(job.contact),
    normalize(job.manager),
    normalize(job.hq),
    normalize(job.description),
  ].join('|')
}

function postedTime(job: Job): number {
  return job.postedAt > 0 ? job.postedAt : Number.MAX_SAFE_INTEGER
}

export function groupDuplicateVacancies(source: readonly Job[]): VacancyDuplicateGroup[] {
  const buckets = new Map<string, Job[]>()
  for (const job of source) {
    const key = duplicateKey(job)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(job)
    else buckets.set(key, [job])
  }
  const groups: VacancyDuplicateGroup[] = []
  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue
    const [first, ...rest] = [...bucket].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
      return postedTime(left) - postedTime(right)
    })
    groups.push({ key, keep: first, remove: rest })
  }
  return groups
}

/** Everyone who would be removed, in list order — used for the preview and the delete loop. */
export function duplicateRemovalIds(groups: readonly VacancyDuplicateGroup[]): string[] {
  return groups.flatMap((group) => group.remove.map((job) => job.id))
}
