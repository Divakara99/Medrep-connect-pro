/**
 * Write-only Supabase mirror for records stored in localStorage.
 *
 * Vite variables override the project's public defaults at build time. The
 * publishable/anon key is intended for browser use; never put a service-role
 * key here.
 */
const DEFAULT_SUPABASE_URL = 'https://lmhmbrusjizncumrufsx.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_4uiy6UZHkIjzAZssMfLWKQ_TwG6x7fC'

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL).replace(/\/+$/, '')
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || DEFAULT_SUPABASE_ANON_KEY

export type SupabaseSyncState = 'off' | 'idle' | 'ok' | 'error'

export type SupabaseSyncStatus = {
  configured: boolean
  url: string
  state: SupabaseSyncState
  lastAt: number | null
  lastTable: string | null
  lastHttpStatus: number | null
}

let syncState: Exclude<SupabaseSyncState, 'off'> = 'idle'
let lastAt: number | null = null
let lastTable: string | null = null
let lastHttpStatus: number | null = null
let latestRequest = 0

export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20
}

/** Insert or replace one mirrored row using its stable id. */
export async function syncToSupabase(table: string, row: Record<string, unknown>): Promise<boolean> {
  if (!isSupabaseConfigured()) return false

  const request = ++latestRequest
  lastAt = Date.now()
  lastTable = table
  lastHttpStatus = null

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    })

    if (request === latestRequest) {
      lastAt = Date.now()
      lastHttpStatus = response.status
      syncState = response.ok ? 'ok' : 'error'
    }
    return response.ok
  } catch {
    if (request === latestRequest) {
      lastAt = Date.now()
      lastHttpStatus = null
      syncState = 'error'
    }
    return false
  }
}

/**
 * Start a mirror write without blocking the local-first UI. The payload keeps
 * the record intact in `data` while the outer id is the table primary key.
 */
export function mirror<T extends { id: string }>(table: string, record: T): void {
  if (!isSupabaseConfigured()) return

  void syncToSupabase(table, {
    id: record.id,
    data: record,
    synced_at: new Date().toISOString(),
  })
}

/** A snapshot for the admin dashboard's polling status card. */
export function getSyncStatus(): SupabaseSyncStatus {
  const configured = isSupabaseConfigured()
  return {
    configured,
    url: SUPABASE_URL,
    state: configured ? syncState : 'off',
    lastAt,
    lastTable,
    lastHttpStatus,
  }
}
