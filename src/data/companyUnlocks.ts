import { loadVisibleJobs, type Job } from './jobs'
import { supabase } from './supabase'

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
  const attempts = options.attempts ?? 10
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

/**
 * The unlock rows this user owns, read straight from the table.
 *
 * One completed video is supposed to unlock that company name forever. When it
 * appears to come back after a restart, the question is binary: is the row
 * missing (the reward was never recorded), or is the row there and the job
 * projection is not reporting it? This answers that on the device. RLS lets a
 * signed-in user read their own rows and nothing else.
 */
export type CompanyUnlock = { jobId: string; createdAt: string }

export async function loadMyUnlocks(): Promise<CompanyUnlock[]> {
  const { data, error } = await supabase
    .from('company_unlocks')
    .select('job_id, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error('Could not read your unlocks.')
  return ((data ?? []) as { job_id?: unknown; created_at?: unknown }[]).map((row) => ({
    jobId: typeof row.job_id === 'string' ? row.job_id : String(row.job_id ?? ''),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  }))
}
