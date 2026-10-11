/**
 * Supabase sync (online backend) — drop-in configuration.
 *
 * The app is fully online-ready: every record written through src/data/* uses
 * stable ids and JSON-serializable shapes matching the Supabase table schemas:
 *
 *   profiles            ← users (auth.ts)
 *   vacancies           ← jobs (jobs.ts)
 *   plans               ← plans (plans.ts)
 *   payments            ← payments.ts (txRef, planDays, expiresAt, activated)
 *   support_tickets     ← tickets.ts
 *   applications        ← apply.ts
 *   notifications       ← notifications.ts
 *
 * Paste your Supabase project credentials below and call `syncToSupabase()`
 * (already a no-op when unconfigured) after any write to mirror data to your
 * project so the admin dashboard sees transactions across every device.
 */

export const SUPABASE_URL = '' // e.g. 'https://xxxxx.supabase.co'
export const SUPABASE_ANON_KEY = '' // Project Settings → API → anon public key

export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20
}

/** Insert a row into a Supabase table via the REST API. Safe no-op when unconfigured. */
export async function syncToSupabase(table: string, row: Record<string, unknown>): Promise<boolean> {
  if (!isSupabaseConfigured()) return false
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    })
    return res.ok
  } catch {
    return false
  }
}
