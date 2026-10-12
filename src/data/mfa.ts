import { supabase } from './supabase'

/**
 * Administrator TOTP multi-factor authentication.
 *
 * This is a real second factor: the six-digit code is checked by Supabase Auth,
 * and only a successful verification upgrades the session's authenticator
 * assurance level to `aal2`. Every admin-only database policy
 * (`public.is_app_admin()`) and every admin Edge Function requires that `aal2`
 * claim, which is signed by Supabase Auth and cannot be produced by the browser.
 *
 * Nothing about MFA is stored in localStorage/sessionStorage — the state lives
 * in the Auth session itself.
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
