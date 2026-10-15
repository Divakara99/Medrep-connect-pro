import type { AuthChangeEvent, User as SupabaseUser } from '@supabase/supabase-js'
import { hasAdminRole, hasVacancyRole, supabase } from './supabase'
import { adminMfaRequired, isMfaVerifiedSession } from './mfa'
import { MIN_STAFF_PASSWORD_LENGTH, MIN_USER_PASSWORD_LENGTH, passwordLengthError } from './passwordRules'
import { passwordResetRedirectTo } from './platform'
import { read, remove, write } from './storage'

export type User = {
  id: string
  email: string
  name: string
  phone?: string
  createdAt: number
  subscribedUntil?: number // epoch ms; loaded from the server-owned Supabase account row
  isAdmin?: boolean
}

export type Session =
  | { kind: 'none' }
  | { kind: 'user'; userId: string }
  | { kind: 'admin' }
  | { kind: 'vacancy' }

export type AuthSnapshot = {
  session: Session
  user: User | null
  /** May this session open the admin console? (verified code, or the switch is OFF) */
  adminVerified?: boolean
  /** Did this session actually pass the authenticator challenge? */
  mfaVerified?: boolean
  /** Is the owner still requiring the six-digit code? */
  mfaRequired?: boolean
}

const USERS_CACHE_KEY = 'mrc_admin_users_cache_v1'
const USER_STATE_KEY = 'mrc_user_state_v1'
const LEGACY_USERS_KEY = 'mrc_users_v1'
const LEGACY_SESSION_KEY = 'mrc_session_v1'

// The former app stored demo passwords and plan entitlements in localStorage.
// Clear them so neither a local cache nor a simulated payment can grant access.
remove(LEGACY_USERS_KEY)
remove(LEGACY_SESSION_KEY)
remove(USER_STATE_KEY)
remove(USERS_CACHE_KEY)

let activeUser: User | null = null

function normalizeLocalPhone(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined
  const digits = raw.replace(/\D/g, '')
  const local = digits.length === 14 && digits.startsWith('0091')
    ? digits.slice(4)
    : digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits
  return /^[6-9]\d{9}$/.test(local) ? local : undefined
}

/** Canonical Indian mobile format used by the database's unique index. */
export function normalizeIndianPhone(raw?: string | null): string | null {
  if (!raw?.trim()) return null
  return normalizeLocalPhone(raw) ?? null
}

function toUser(authUser: SupabaseUser): User {
  const metadata = authUser.user_metadata ?? {}
  const serverExpiry = activeUser?.id === authUser.id ? activeUser.subscribedUntil : undefined
  const name = typeof metadata.name === 'string'
    ? metadata.name
    : typeof metadata.full_name === 'string'
      ? metadata.full_name
      : authUser.email?.split('@')[0] ?? 'Job Seeker'
  const phone = typeof metadata.phone === 'string' ? normalizeLocalPhone(metadata.phone) : undefined

  return {
    id: authUser.id,
    email: authUser.email ?? '',
    name,
    phone,
    createdAt: authUser.created_at ? new Date(authUser.created_at).getTime() : Date.now(),
    subscribedUntil: serverExpiry,
    isAdmin: hasAdminRole(authUser),
  }
}

function snapshotFromSession(session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']): AuthSnapshot {
  if (!session?.user) {
    activeUser = null
    return { session: { kind: 'none' }, user: null }
  }

  const user = toUser(session.user)
  activeUser = user
  if (user.isAdmin) return { session: { kind: 'admin' }, user }
  if (hasVacancyRole(session.user)) return { session: { kind: 'vacancy' }, user }
  return { session: { kind: 'user', userId: user.id }, user }
}

async function withServerSubscription(user: User): Promise<User> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select('subscribed_until')
    .eq('user_id', user.id)
    .maybeSingle()
  // If the server entitlement cannot be read, never reuse a cached expiry.
  if (error) {
    const locked = { ...user, subscribedUntil: undefined }
    if (activeUser?.id === user.id) activeUser = locked
    return locked
  }

  const updated: User = {
    ...user,
    subscribedUntil: data?.subscribed_until ? new Date(data.subscribed_until).getTime() : undefined,
  }
  if (activeUser?.id === user.id) activeUser = updated
  return updated
}

export async function getAuthSnapshot(): Promise<AuthSnapshot> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const snapshot = snapshotFromSession(data.session)
  if (!snapshot.user) return snapshot
  if (snapshot.session.kind === 'vacancy') {
    // Team logins have no subscription and no admin data; the vacancy portal
    // checks what it needs through its own functions.
    return snapshot
  }
  if (snapshot.session.kind === 'admin') {
    // Admin data needs a verified authenticator — unless the owner switched the
    // sign-in code off, which the database's is_app_admin() honours as well. The
    // switch is read from the server, so the console never promises access the
    // database would refuse.
    const mfaVerified = await isMfaVerifiedSession()
    const mfaRequired = mfaVerified ? true : await adminMfaRequired()
    return { ...snapshot, mfaVerified, mfaRequired, adminVerified: mfaVerified || !mfaRequired }
  }

  try {
    const user = await withServerSubscription(snapshot.user)
    return { ...snapshot, user }
  } catch {
    // Auth stays available, but never keep a stale paid entitlement on error.
    const locked = { ...snapshot.user, subscribedUntil: undefined }
    if (activeUser?.id === locked.id) activeUser = locked
    return { ...snapshot, user: locked }
  }
}

export async function refreshCurrentSubscription(): Promise<User | null> {
  const snapshot = await getAuthSnapshot()
  return snapshot.user
}

export function onAuthStateChange(
  callback: (event: AuthChangeEvent, snapshot: AuthSnapshot) => void,
): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const snapshot = snapshotFromSession(session)
    callback(event, snapshot)
  })
  return () => subscription.unsubscribe()
}

export function getUsers(): User[] {
  return read<User[]>(USERS_CACHE_KEY, [])
}

export async function refreshAdminUsers(): Promise<User[]> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (!session || !hasAdminRole(session.user)) {
    throw new Error('Only a signed-in administrator can view account records.')
  }

  const { data, error } = await supabase
    .from('user_accounts')
    .select('user_id,email,name,phone,created_at,subscribed_until,is_admin')
    .order('created_at', { ascending: false })
  if (error) throw error

  type AccountRow = {
    user_id: string
    email: string
    name: string
    phone: string | null
    created_at: string
    subscribed_until: string | null
    is_admin: boolean
  }
  const rows = (data ?? []) as unknown as AccountRow[]
  const users = rows.map((row): User => ({
    id: row.user_id,
    email: row.email,
    name: row.name,
    phone: row.phone ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    subscribedUntil: row.subscribed_until ? new Date(row.subscribed_until).getTime() : undefined,
    isAdmin: row.is_admin,
  }))
  write(USERS_CACHE_KEY, users)
  return users
}

export function findUserByEmail(email: string): User | undefined {
  const normalizedEmail = email.trim().toLowerCase()
  return getUsers().find((user) => user.email.toLowerCase() === normalizedEmail)
}

function authErrorMessage(message: string, hasPhone = false): string {
  if (/user already registered|already been registered|email.*already|duplicate key.*email/i.test(message)) {
    return 'An account with this email already exists. Sign in instead.'
  }
  if (/user_accounts_normalized_phone|normalized_phone|phone.*already|duplicate key/i.test(message)) {
    return 'That mobile number is already registered. Use a different number or leave it blank.'
  }
  if (hasPhone && /database error (saving new user|updating user)|hook|trigger/i.test(message)) {
    return 'The mobile number may already be registered or invalid. Check it and try again.'
  }
  return message
}

export async function registerUser(input: {
  name: string
  email: string
  phone?: string
  password: string
}): Promise<{ ok: true; user: User; confirmationRequired: boolean } | { ok: false; error: string }> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const phone = normalizeIndianPhone(input.phone)
  const hasPhone = Boolean(input.phone?.trim())

  if (!name || !email || !input.password) {
    return { ok: false, error: 'Name, email and password are required.' }
  }
  // Every account: 6 characters are enough (6–10 work, longer is fine).
  const passwordError = passwordLengthError(input.password, MIN_USER_PASSWORD_LENGTH)
  if (passwordError) {
    return { ok: false, error: passwordError }
  }
  if (hasPhone && !phone) {
    return { ok: false, error: 'Enter a valid 10-digit Indian mobile number.' }
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      data: { name, phone },
    },
  })
  if (error) return { ok: false, error: authErrorMessage(error.message, hasPhone) }
  if (!data.user) return { ok: false, error: 'Supabase Auth did not return an account. Please try again.' }

  const user = toUser(data.user)
  activeUser = data.session ? user : null
  return { ok: true, user, confirmationRequired: !data.session }
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error) return { ok: false, error: authErrorMessage(error.message) }
  if (!data.user) return { ok: false, error: 'Sign-in did not return an account. Please try again.' }
  if (hasAdminRole(data.user) || hasVacancyRole(data.user)) {
    activeUser = null
    await supabase.auth.signOut()
    // The public form should never advertise the restricted entry routes.
    return { ok: false, error: 'This account cannot sign in here. Contact support if you need help.' }
  }

  const user = toUser(data.user)
  activeUser = user
  return { ok: true, user }
}

export async function loginAdmin(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error) return { ok: false, error: authErrorMessage(error.message) }
  if (!data.user || !hasAdminRole(data.user)) {
    await supabase.auth.signOut()
    return { ok: false, error: 'This account is not an administrator.' }
  }

  activeUser = toUser(data.user)
  return { ok: true }
}

/** Vacancy team sign-in. Logins are created by the administrator only. */
export async function loginVacancyTeam(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error) return { ok: false, error: authErrorMessage(error.message) }
  if (!data.user || !hasVacancyRole(data.user)) {
    activeUser = null
    await supabase.auth.signOut()
    return { ok: false, error: 'This login is not a vacancy team account. Ask the administrator for your login.' }
  }

  activeUser = toUser(data.user)
  return { ok: true }
}

export async function resetPassword(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // Inside the Android app window.location.origin is https://localhost, which
  // is not a usable email redirect. Reset emails from the app land on the
  // website instead (its origin must be allow-listed in Supabase Auth).
  const redirectTo = passwordResetRedirectTo()
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** True for administrator and vacancy-team accounts (trusted role claims). */
export function isStaffUser(user: Pick<SupabaseUser, 'app_metadata'> | null | undefined): boolean {
  return hasAdminRole(user) || hasVacancyRole(user)
}

/**
 * Set the password of the signed-in recovery session.
 *
 * Every account now uses the same 6-character minimum (see passwordRules.ts),
 * on every screen. Callers pass the minimum for the account's actual role —
 * the job-seeker reset page resolves it from the recovery session itself, so
 * an admin resetting there is held to the staff rule, not assumed to be a
 * job seeker. The default stays the staff rule.
 */
export async function updatePassword(
  password: string,
  minimumLength: number = MIN_STAFF_PASSWORD_LENGTH,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const passwordError = passwordLengthError(password, minimumLength)
  if (passwordError) return { ok: false, error: passwordError }
  const { data, error } = await supabase.auth.updateUser({ password })
  if (error) return { ok: false, error: error.message }
  if (data.user) activeUser = toUser(data.user)
  return { ok: true }
}

/** Update Auth metadata so the database trigger can enforce phone uniqueness. */
export async function updateCurrentPhone(
  rawPhone?: string,
): Promise<{ ok: true; phone?: string } | { ok: false; error: string }> {
  const phone = normalizeIndianPhone(rawPhone)
  if (rawPhone?.trim() && !phone) {
    return { ok: false, error: 'Enter a valid 10-digit Indian mobile number.' }
  }

  const { data, error } = await supabase.auth.updateUser({ data: { phone } })
  if (error) return { ok: false, error: authErrorMessage(error.message, Boolean(rawPhone?.trim())) }
  if (data.user) activeUser = toUser(data.user)
  return { ok: true, phone: phone ?? undefined }
}

/**
 * Admin-only: grant special access to a user (audited server-side in
 * subscription_payments as a manual_grant row).
 */
export async function grantManualAccess(
  userId: string,
  days: number,
): Promise<{ ok: true; expiresAt?: string } | { ok: false; error: string }> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !session || !hasAdminRole(session.user)) {
    return { ok: false, error: 'Only a signed-in administrator can grant access.' }
  }
  const { data, error } = await supabase.rpc('grant_manual_access', { p_user_id: userId, p_days: days })
  if (error) return { ok: false, error: error.message || 'Access could not be granted. Run supabase/admin_access.sql and try again.' }
  const expiresAt = (data as { expires_at?: string } | null)?.expires_at
  return { ok: true, expiresAt }
}

export async function deleteUserAccount(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) return { ok: false, error: sessionError.message }
  if (!session || !hasAdminRole(session.user)) {
    return { ok: false, error: 'Only a signed-in administrator can delete accounts.' }
  }
  if (userId === session.user.id) {
    return { ok: false, error: 'You cannot delete the active administrator account.' }
  }

  const { error } = await supabase.functions.invoke('admin-delete-user', {
    body: { userId },
  })
  if (error) {
    const context = (error as Error & { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { error?: string }
        if (payload.error) return { ok: false, error: payload.error }
      } catch {
        // Keep the SDK's message when the function response is not JSON.
      }
    }
    return { ok: false, error: error.message }
  }

  write(USERS_CACHE_KEY, getUsers().filter((user) => user.id !== userId))
  return { ok: true }
}

export async function logout(): Promise<void> {
  activeUser = null
  remove(USERS_CACHE_KEY)
  await supabase.auth.signOut()
}

/** The current session user, refreshed by Auth events and getAuthSnapshot(). */
export function currentUser(): User | null {
  return activeUser
}

export function isSubscribed(user: User | null | undefined): boolean {
  if (!user?.subscribedUntil) return false
  return user.subscribedUntil > Date.now()
}
