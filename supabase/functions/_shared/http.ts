export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200, cors = true): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(cors ? corsHeaders : {}),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function isAdmin(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.role === 'admin'
    || metadata?.is_admin === true
    || metadata?.is_admin === 'true'
}

/** Vacancy team logins: created by an administrator, post and delete only. */
export function isVacancyEditor(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.role === 'vacancy_editor'
}

/**
 * The administrator gate shared by every admin Edge Function.
 *
 * `aal2` is the verified-code session Supabase Auth issues after the six-digit
 * authenticator challenge. The owner can switch the sign-in code off from the
 * admin console (public.set_admin_mfa_required), and the database's
 * `is_app_admin()` honours the same flag — so this must too, or a console that
 * opens without a code would fail on every button.
 *
 * Fail safe: anything other than an explicit `false` counts as "code required".
 */
export function adminAccessAllowed(aal2: boolean, mfaRequired: boolean): boolean {
  return aal2 || mfaRequired === false
}
