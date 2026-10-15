import { loadVisibleJobs, type Job } from './jobs'

/**
 * Company-name unlocks earned by watching a rewarded video.
 *
 * The unlock row is written only by the admob-reward-verification Edge
 * Function (AdMob server-side verification → service role). The app can
 * therefore do exactly one thing after a video completes: ask the server
 * again. `pollForCompanyUnlock` re-reads the job projection briefly —
 * SSV callbacks usually land within a few seconds — and stops as soon as
 * the job comes back with `companyUnlocked`, the user subscribes, or the
 * attempts run out. The subscription flag is never touched here.
 */
export async function pollForCompanyUnlock(
  jobId: string,
  options: { attempts?: number; delayMs?: number; onJobs?: (jobs: Job[]) => void } = {},
): Promise<Job | null> {
  const attempts = options.attempts ?? 15
  const delayMs = options.delayMs ?? 2000
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    try {
      const jobs = await loadVisibleJobs()
      options.onJobs?.(jobs)
      const job = jobs.find((candidate) => candidate.id === jobId) ?? null
      if (job?.companyUnlocked || job?.company) return job
    } catch {
      // Keep polling: a transient read failure must not lose a paid-for view.
    }
  }
  return null
}
