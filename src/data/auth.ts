import { CREATOR } from './creator'
import { broadcast } from './notifications'
import { mirror } from './supabase'
import { read, write } from './storage'

export type User = {
  id: string
  email: string
  name: string
  phone?: string
  createdAt: number
  subscribedUntil?: number // epoch ms
  isAdmin?: boolean
}

export type Session =
  | { kind: 'none' }
  | { kind: 'user'; userId: string }
  | { kind: 'admin' }

const USERS_KEY = 'mrc_users_v1'
const SESSION_KEY = 'mrc_session_v1'

// The local demo user also stores a plaintext password; only this explicit
// field whitelist is ever copied to the remote mirror.
function mirrorUser(user: User) {
  mirror('users', {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    createdAt: user.createdAt,
    subscribedUntil: user.subscribedUntil,
    isAdmin: user.isAdmin,
  })
}

function uid() {
  return 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function getUsers(): User[] {
  return read<User[]>(USERS_KEY, [])
}

export function getSession(): Session {
  return read<Session>(SESSION_KEY, { kind: 'none' })
}

export function saveSession(s: Session) {
  write(SESSION_KEY, s)
}

export function findUserByEmail(email: string): User | undefined {
  const e = email.trim().toLowerCase()
  return getUsers().find((u) => u.email.toLowerCase() === e)
}

export function registerUser(input: {
  name: string
  email: string
  phone?: string
  password: string
}): { ok: true; user: User } | { ok: false; error: string } {
  const email = input.email.trim().toLowerCase()
  if (!email || !input.password || !input.name) {
    return { ok: false, error: 'Name, email and password are required.' }
  }
  if (input.password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' }
  }
  // Prevent regular registration with admin email.
  if (email === CREATOR.adminEmail.toLowerCase()) {
    return { ok: false, error: 'That email is reserved. Use admin login.' }
  }
  if (findUserByEmail(email)) {
    return { ok: false, error: 'An account with this email already exists.' }
  }
  // NOTE: In a real app, never store plaintext passwords. This is a local-only demo.
  const user: User & { password?: string } = {
    id: uid(),
    email,
    name: input.name.trim(),
    phone: input.phone?.trim(),
    createdAt: Date.now(),
  }
  // We persist password ONLY because this is a local-storage demo without backend.
  const users = getUsers()
  users.push({ ...user, password: input.password } as User)
  write(USERS_KEY, users)
  mirrorUser(user)
  saveSession({ kind: 'user', userId: user.id })
  // Welcome notification — AI-generated from Mr. Divakar Reddy to the new user.
  broadcast({ kind: 'welcome', userName: user.name }, { type: 'system' })
  return { ok: true, user }
}

export function loginUser(
  email: string,
  password: string,
): { ok: true; user: User } | { ok: false; error: string } {
  const e = email.trim().toLowerCase()
  const users = getUsers()
  const u = users.find((x) => x.email.toLowerCase() === e) as
    | (User & { password?: string })
    | undefined
  if (!u || u.password !== password) {
    return { ok: false, error: 'Invalid email or password.' }
  }
  saveSession({ kind: 'user', userId: u.id })
  return { ok: true, user: u }
}

export function loginAdmin(
  email: string,
  password: string,
): { ok: true } | { ok: false; error: string } {
  if (
    email.trim().toLowerCase() === CREATOR.adminEmail.toLowerCase() &&
    password === CREATOR.adminPassword
  ) {
    saveSession({ kind: 'admin' })
    return { ok: true }
  }
  return { ok: false, error: 'Invalid admin credentials.' }
}

export function resetPassword(email: string, newPassword: string): { ok: true } | { ok: false; error: string } {
  const e = email.trim().toLowerCase()
  const users = getUsers()
  const idx = users.findIndex((x) => x.email.toLowerCase() === e)
  if (idx === -1) return { ok: false, error: 'No account found for that email.' }
  if (newPassword.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' }
  ;(users[idx] as User & { password?: string }).password = newPassword
  write(USERS_KEY, users)
  return { ok: true }
}

export function logout() {
  saveSession({ kind: 'none' })
}

export function currentUser(): User | null {
  const s = getSession()
  if (s.kind !== 'user') return null
  const users = getUsers()
  return users.find((u) => u.id === s.userId) ?? null
}

export function updateUser(userId: string, patch: Partial<User>) {
  const users = getUsers()
  const idx = users.findIndex((u) => u.id === userId)
  if (idx === -1) return null
  users[idx] = { ...users[idx], ...patch }
  write(USERS_KEY, users)
  mirrorUser(users[idx])
  return users[idx]
}

export function subscribeUser(userId: string, days: number) {
  const until = Date.now() + days * 24 * 60 * 60 * 1000
  return updateUser(userId, { subscribedUntil: until })
}

export function isSubscribed(u: User | null | undefined): boolean {
  if (!u) return false
  if (!u.subscribedUntil) return false
  return u.subscribedUntil > Date.now()
}
