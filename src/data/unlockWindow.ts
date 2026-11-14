import type { Job } from './jobs'

/**
 * How long one rewarded video keeps a job's company name visible.
 *
 * The database owns this rule (`expires_at` default in
 * supabase/company_unlocks.sql); this constant exists so the app can show a
 * countdown and re-lock the card at the right moment without waiting for a
 * round trip. If you change the window, change BOTH places.
 */
export const UNLOCK_WINDOW_MINUTES = 10

export function unlockRemainingMs(
  unlockExpiresAt: string | null | undefined,
  now = Date.now(),
): number {
  if (!unlockExpiresAt) return 0
  const expiresAt = Date.parse(unlockExpiresAt)
  if (Number.isNaN(expiresAt)) return 0
  return Math.max(0, expiresAt - now)
}

/**
 * True while a video unlock for this job is still running.
 *
 * A job with `companyUnlocked` but no expiry is treated as unlocked: subscribers
 * get their company name that way, and older rows predate the window.
 */
export function unlockActive(
  job: Pick<Job, 'companyUnlocked' | 'unlockExpiresAt'>,
  now = Date.now(),
): boolean {
  if (job.companyUnlocked !== true) return false
  if (!job.unlockExpiresAt) return true
  return unlockRemainingMs(job.unlockExpiresAt, now) > 0
}

/**
 * True while a paid ₹5 unlock for this job is still running. The server already
 * withholds the fields once the 24-hour window is up; this only keeps an open
 * sheet from showing stale values until the next read.
 */
export function paidUnlockActive(
  job: Pick<Job, 'jobUnlocked' | 'jobUnlockExpiresAt'>,
  now = Date.now(),
): boolean {
  if (job.jobUnlocked !== true) return false
  if (!job.jobUnlockExpiresAt) return true
  return unlockRemainingMs(job.jobUnlockExpiresAt, now) > 0
}

/** "9 min left", "40 s left" — never negative. */
export function formatUnlockRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return '0 s'
  if (remainingMs >= 24 * 60 * 60 * 1000) return `${Math.ceil(remainingMs / (24 * 60 * 60 * 1000))} d`
  if (remainingMs >= 60 * 60 * 1000) return `${Math.ceil(remainingMs / (60 * 60 * 1000))} h`
  const seconds = Math.ceil(remainingMs / 1000)
  if (seconds < 60) return `${seconds} s`
  return `${Math.ceil(seconds / 60)} min`
}
