import { useEffect, useState } from 'react'
import type { Job } from '../data/jobs'
import { formatUnlockRemaining, paidUnlockActive, unlockActive, unlockRemainingMs } from '../data/unlockWindow'

/**
 * The countdown for a rewarded-video unlock.
 *
 * Cards are rendered once and then sit there, so without a clock a job would
 * keep its company name for as long as the screen stayed open. Re-rendering on a
 * short interval lets the name disappear on time — and the next server read
 * agrees, because list_visible_jobs() applies the same rule.
 */
export function useUnlockWindow(job: Pick<Job, 'companyUnlocked' | 'unlockExpiresAt'>) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (job.companyUnlocked !== true || !job.unlockExpiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [job.companyUnlocked, job.unlockExpiresAt])

  const remainingMs = unlockRemainingMs(job.unlockExpiresAt, now)
  return {
    active: unlockActive(job, now),
    remainingMs,
    label: formatUnlockRemaining(remainingMs),
  }
}

/**
 * Paid ₹5 unlock status for one job. New purchases expire after 24 hours;
 * legacy permanent rows have no expiry and remain active.
 */
export function usePaidUnlockWindow(job: Pick<Job, 'jobUnlocked' | 'jobUnlockExpiresAt'>) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (job.jobUnlocked !== true || !job.jobUnlockExpiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [job.jobUnlocked, job.jobUnlockExpiresAt])

  const remainingMs = unlockRemainingMs(job.jobUnlockExpiresAt, now)
  return { active: paidUnlockActive(job, now), remainingMs, label: formatUnlockRemaining(remainingMs) }
}
