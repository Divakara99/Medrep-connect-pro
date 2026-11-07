import { useEffect, useState } from 'react'
import type { Job } from '../data/jobs'
import { formatUnlockRemaining, unlockActive, unlockRemainingMs } from '../data/unlockWindow'

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
