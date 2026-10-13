import { supabase } from './supabase'

/**
 * Administrator TOTP multi-factor authentication.
 *
 * This is a real second factor: the six-digit code is checked by Supabase Auth,
 * and only a successful verification upgrades the session's authenticator
 * assurance level to `aal2`. While the sign-in code is switched ON — the default
 * on every project — each admin-only database policy (`public.is_app_admin()`)
 * and every admin Edge Function requires that `aal2` claim, which is signed by
 * Supabase Auth and cannot be produced by the browser.
 *
 * The owner can switch the code OFF from the admin console
 * (`setAdminMfaRequired`). That state lives server side in public.app_settings
 * and is read by `is_app_admin()` itself, so with the switch off a password-only
 * (aal1) admin session is accepted — a deliberate, audited reduction of admin
 * security. Nothing about MFA is stored in localStorage/sessionStorage.
 */
export type TotpFactor = {
  id: string
  friendlyName: string
  status: 'verified' | 'unverified'
  createdAt: string
}

export type TotpEnrollment = {
  factorId: string
  secret: string
  qrCode: string // SVG data URI for the authenticator app to scan
  uri: string // otpauth:// fallback for manual entry
}

export type MfaResult = { ok: true } | { ok: false; error: string }

const FACTOR_LABEL = 'MedRep Connect Pro admin'

function message(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message
    if (typeof value === 'string' && value.trim()) return value
  }
  return fallback
}

/** Every TOTP factor on the account, verified or still awaiting first use. */
export async function listTotpFactors(): Promise<TotpFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw new Error(message(error, 'Could not read the authenticator settings.'))
  return (data?.all ?? [])
    .filter((factor) => factor.factor_type === 'totp')
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name ?? 'Authenticator',
      status: factor.status === 'verified' ? 'verified' as const : 'unverified' as const,
      createdAt: factor.created_at,
    }))
}

/** Start enrolling an authenticator app. Returns the QR image and secret. */
export async function enrollTotp(): Promise<{ ok: true; enrollment: TotpEnrollment } | { ok: false; error: string }> {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: FACTOR_LABEL })
  if (error) return { ok: false, error: message(error, 'Could not start authenticator enrollment.') }
  if (!data || data.type !== 'totp') return { ok: false, error: 'Authenticator enrollment is not available on this project.' }
  return {
    ok: true,
    enrollment: {
      factorId: data.id,
      secret: data.totp.secret,
      qrCode: data.totp.qr_code,
      uri: data.totp.uri,
    },
  }
}

/**
 * Verify a six-digit code against a factor. On success Supabase Auth issues a
 * new session whose JWT carries `aal: aal2`.
 */
export async function verifyTotp(factorId: string, code: string): Promise<MfaResult> {
  const digits = code.replace(/\D/g, '')
  if (digits.length !== 6) return { ok: false, error: 'Enter the six-digit code from your authenticator app.' }

  const challenge = await supabase.auth.mfa.challenge({ factorId })
  if (challenge.error || !challenge.data?.id) {
    return { ok: false, error: message(challenge.error, 'Could not start the authenticator challenge.') }
  }
  const verification = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: digits })
  if (verification.error) {
    return { ok: false, error: message(verification.error, 'That code was not accepted. Check the time on your device and try again.') }
  }
  return { ok: true }
}

export async function unenrollTotp(factorId: string): Promise<MfaResult> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) return { ok: false, error: message(error, 'Could not remove the authenticator.') }
  return { ok: true }
}

/**
 * True only when Supabase Auth reports the CURRENT session as `aal2`, i.e. the
 * administrator has verified a TOTP code for this session. This is the same
 * condition the database checks, so the UI never promises access the server
 * would refuse.
 */
export async function isMfaVerifiedSession(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !data) return false
  return data.currentLevel === 'aal2'
}

/** Does the account already have a verified authenticator to sign in with? */
export async function hasVerifiedTotpFactor(): Promise<boolean> {
  try {
    const factors = await listTotpFactors()
    return factors.some((factor) => factor.status === 'verified')
  } catch {
    return false
  }
}

export type AdminSecurityState = {
  mfaRequired: boolean
  mfaVerified: boolean
  aal: string
  isAdmin: boolean
  changedBy: string | null
  changedAt: string | null
}

/**
 * The server's view of admin security: whether the sign-in code is required,
 * whether THIS session satisfied it, and who last changed the switch.
 */
export async function adminSecurityState(): Promise<AdminSecurityState | null> {
  const { data, error } = await supabase.rpc('admin_security_state')
  if (error || !data) return null
  const row = data as Record<string, unknown>
  return {
    mfaRequired: row.mfaRequired !== false,
    mfaVerified: row.mfaVerified === true,
    aal: typeof row.aal === 'string' ? row.aal : 'aal1',
    isAdmin: row.isAdmin === true,
    changedBy: typeof row.changedBy === 'string' ? row.changedBy : null,
    changedAt: typeof row.changedAt === 'string' ? row.changedAt : null,
  }
}

/**
 * Is the code switch ON? Fails safe: any problem counts as "required", which is
 * the same answer the database gives.
 */
export async function adminMfaRequired(): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_mfa_required')
  if (error || typeof data !== 'boolean') return true
  return data
}

export type SecurityToggleResult =
  | { ok: true; state: AdminSecurityState }
  | { ok: false; error: string }

/**
 * Switch the administrator sign-in code on or off. The database performs the
 * authorization (administrator only) and records who changed it and with which
 * code state.
 */
export async function setAdminMfaRequired(required: boolean): Promise<SecurityToggleResult> {
  const { data, error } = await supabase.rpc('set_admin_mfa_required', { p_required: required })
  if (error) {
    return {
      ok: false,
      error: /could not find the function|schema cache/i.test(error.message)
        ? 'The sign-in code switch is not available yet — run supabase/admin_mfa.sql in the Supabase project.'
        : /Only an administrator|42501/i.test(error.message)
          ? 'Only an administrator can change the sign-in code setting.'
          : error.message || 'The sign-in code setting could not be changed.',
    }
  }
  const row = (data ?? {}) as Record<string, unknown>
  return {
    ok: true,
    state: {
      mfaRequired: row.mfaRequired !== false,
      mfaVerified: row.mfaVerified === true,
      aal: typeof row.aal === 'string' ? row.aal : 'aal1',
      isAdmin: row.isAdmin === true,
      changedBy: typeof row.changedBy === 'string' ? row.changedBy : null,
      changedAt: typeof row.changedAt === 'string' ? row.changedAt : null,
    },
  }
}

export type SecurityChange = { changedBy: string; changedAal: string; required: boolean; changedAt: string }

/** The audit trail of sign-in code changes (administrators only, newest first). */
export async function adminSecurityAudit(limit = 5): Promise<SecurityChange[]> {
  const { data, error } = await supabase
    .from('app_settings_audit')
    .select('value,changed_by,changed_aal,changed_at')
    .eq('key', 'admin_mfa')
    .order('id', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return (data as unknown as { value: Record<string, unknown>; changed_by: string | null; changed_aal: string | null; changed_at: string }[])
    .map((row) => ({
      changedBy: row.changed_by ?? 'unknown',
      changedAal: row.changed_aal ?? 'aal1',
      required: row.value?.required !== false,
      changedAt: row.changed_at,
    }))
}
