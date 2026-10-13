import { createClient, type User as SupabaseUser } from '@supabase/supabase-js'

/**
 * Public browser configuration. The publishable/anon key is expected to be in
 * the bundle; RLS is the security boundary. Never add a service-role key here.
 */
const DEFAULT_SUPABASE_URL = 'https://lmhmbrusjizncumrufsx.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_4uiy6UZHkIjzAZssMfLWKQ_TwG6x7fC'

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL).replace(/\/+$/, '')
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || DEFAULT_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
    storageKey: 'mrc_supabase_auth_v1',
  },
})

export function hasAdminRole(user: Pick<SupabaseUser, 'app_metadata'> | null | undefined): boolean {
  const metadata = user?.app_metadata
  return metadata?.role === 'admin' || metadata?.is_admin === true || metadata?.is_admin === 'true'
}

/** Vacancy team logins: set by the administrator, can only post and delete vacancies. */
export function hasVacancyRole(user: Pick<SupabaseUser, 'app_metadata'> | null | undefined): boolean {
  return user?.app_metadata?.role === 'vacancy_editor'
}

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

/** Upsert a mirrored record using the current Supabase Auth session. */
export async function syncToSupabase(table: string, row: Record<string, unknown>): Promise<boolean> {
  if (!isSupabaseConfigured()) return false

  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  // The mirror is deliberately admin-only. Normal users keep personal/demo
  // state on this device; their publishable key cannot write any mirror table.
  if (sessionError || !session || !hasAdminRole(session.user)) return false

  const request = ++latestRequest
  lastAt = Date.now()
  lastTable = table
  lastHttpStatus = null

  try {
    const { error, status } = await supabase
      .from(table)
      .upsert(row, { onConflict: 'id' })

    if (request === latestRequest) {
      lastAt = Date.now()
      lastHttpStatus = error ? status : 200
      syncState = error ? 'error' : 'ok'
    }
    return !error
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
 * Admin-authenticated writes only. Supabase Auth supplies the bearer token to
 * PostgREST; RLS independently verifies its trusted app_metadata role.
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
