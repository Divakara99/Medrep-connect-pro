// City and HQ filter helpers, with no runtime dependencies.
//
// A vacancy can be open in more than one city ("Mumbai / Pune") and can have
// several HQ lines ("Hyderabad HO", "Vijayawada"). The filter options are built
// from the live feed, so a user can only choose a city or HQ that a published
// vacancy actually names — and a multi-entry field still matches on any entry.

export type Locatable = { location?: string; hq?: string }

/** The cities a vacancy is open in ("Mumbai / Pune" is two). */
export function cityEntries(location?: string): string[] {
  return (location || '')
    .split(/[,/|]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** The HQ lines of a vacancy, one per line as entered by the admin. */
export function hqEntries(hq?: string): string[] {
  return (hq || '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Distinct values in feed order, deduplicated case-insensitively, sorted.
 * The first spelling seen wins, so the screen never shows "Mumbai" twice.
 */
function unique(values: string[]): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.set(key, value.trim())
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** Cities present in the feed, alphabetically. */
export function cityOptions(jobs: Locatable[]): string[] {
  return unique(jobs.flatMap((job) => cityEntries(job.location)))
}

/** Headquarters present in the feed, alphabetically. */
export function hqOptions(jobs: Locatable[]): string[] {
  return unique(jobs.flatMap((job) => hqEntries(job.hq)))
}

/** True when a vacancy's city field names the chosen city (any entry). */
export function matchesCity(job: Locatable, city: string): boolean {
  const needle = city.trim().toLowerCase()
  if (!needle) return true
  return cityEntries(job.location).some((entry) => entry.toLowerCase().includes(needle))
}

/** True when a vacancy's HQ field names the chosen HQ (any entry). */
export function matchesHq(job: Locatable, hq: string): boolean {
  const needle = hq.trim().toLowerCase()
  if (!needle) return true
  return hqEntries(job.hq).some((entry) => entry.toLowerCase().includes(needle))
}
