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

// ---------------------------------------------------------------------------
// Edge Functions called with the signed-in session
// ---------------------------------------------------------------------------

/**
 * The server's own sentence for a failed call, when it sent one.
 *
 * `functions.invoke` reports "non-2xx status code"; the function's JSON body
 * carries the reason the administrator actually needs ("Verify your
 * authenticator code…"), so read that first.
 */
async function edgeFunctionMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as Error & { context?: unknown })?.context
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: unknown }
      if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error
    } catch {
      // Not JSON — fall through to the SDK message.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * Call an Edge Function with the signed-in session's access token.
 *
 * `functions.invoke` reads whatever the client currently holds. On a cold start
 * (a reload, or the app resuming from the background) that can still be the
 * anonymous key, and the function then answers "The Supabase session is invalid
 * or expired" even though the administrator is signed in. The token is
 * therefore read (and, when the server still says it is expired, refreshed)
 * before the call, and the call is retried once.
 */
export async function callEdgeFunction(
  name: string,
  body: Record<string, unknown> = {},
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  let expired = false
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await sessionAccessToken(attempt > 0)
    if (!token) {
      return expired
        ? { data: null, error: 'The Supabase session is invalid or expired.' }
        : { data: null, error: 'Please sign in again — this session has ended.' }
    }
    const { data, error } = await supabase.functions.invoke(name, {
      body,
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!error) {
      const payload = (data ?? {}) as Record<string, unknown> & { error?: unknown }
      if (typeof payload.error === 'string' && payload.error.trim()) {
        return { data: null, error: payload.error }
      }
      return { data: payload, error: null }
    }
    const message = await edgeFunctionMessage(error, 'The service could not be reached.')
    if (attempt === 0 && /session is invalid or expired/i.test(message)) {
      expired = true
      continue
    }
    return { data: null, error: message }
  }
  return { data: null, error: 'The service could not be reached. Try again.' }
}

/** The stored access token, optionally after a refresh. */
async function sessionAccessToken(refresh: boolean): Promise<string | null> {
  if (refresh) {
    const { data, error } = await supabase.auth.refreshSession()
    if (!error && data.session?.access_token) return data.session.access_token
  }
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
