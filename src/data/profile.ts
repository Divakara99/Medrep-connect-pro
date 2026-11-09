import { remove } from './storage'
import { supabase } from './supabase'

export { profileCompletionIssues, PROFILE_BIO_MIN_LENGTH } from './profileRules'

export type Education = {
  id: string
  degree: string
  institution: string
  field: string
  year: string
}

export type Experience = {
  id: string
  title: string
  company: string
  duration: string
  description: string
}

export type Profile = {
  email: string
  tagline: 'Job Seeker'
  phone?: string
  city?: string
  state?: string
  dob?: string
  gender?: 'Male' | 'Female' | 'Other' | ''
  languages?: string[]
  skills?: string[]
  preferredRoles?: string[]
  ctc?: string
  noticePeriod?: string
  bio?: string
  education: Education[]
  experience: Experience[]
  updatedAt?: number
}

const LEGACY_PROFILES_KEY = 'mrc_profiles_v1'

/**
 * Profiles live ONLINE (public.job_profiles, one row per signed-in account).
 *
 * This module used to keep them in localStorage and only mirror them into an
 * admin-only table, which meant a cleared browser or a new phone lost the
 * profile. The browser now holds an in-memory copy for the current session and
 * Supabase is the only place a profile is stored. Anything that needs to be
 * sure it is reading the server's copy awaits `refreshProfile()` first.
 */
const profiles = new Map<string, Profile>()

// Remove the old browser copy on start-up; the server row is the profile now.
remove(LEGACY_PROFILES_KEY)

export function profileKey(email: string) {
  return email.trim().toLowerCase()
}

function emptyProfile(email: string): Profile {
  return { email: profileKey(email), tagline: 'Job Seeker', education: [], experience: [] }
}

/** The profile known for this session, or a blank one. Never touches storage. */
export function getProfile(email: string): Profile {
  const key = profileKey(email)
  return profiles.get(key) ?? emptyProfile(key)
}

/** Forget every cached profile (sign-out, account switch). */
export function clearProfileCache(): void {
  profiles.clear()
}

function normalise(value: unknown, email: string): Profile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Partial<Profile>
  return {
    ...emptyProfile(email),
    ...row,
    email: profileKey(email),
    tagline: 'Job Seeker',
    education: Array.isArray(row.education) ? row.education : [],
    experience: Array.isArray(row.experience) ? row.experience : [],
  }
}

/**
 * Read this account's profile from Supabase into memory.
 * A missing row is not an error: it is simply a profile that has not been
 * filled in yet.
 */
export async function refreshProfile(email: string): Promise<Profile> {
  const key = profileKey(email)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || profileKey(user.email ?? '') !== key) return getProfile(key)

  const { data, error } = await supabase
    .from('job_profiles')
    .select('data')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) {
    // Offline or the migration has not run: keep whatever this session has.
    return getProfile(key)
  }
  const loaded = normalise((data as { data?: unknown } | null)?.data, key)
  if (loaded) profiles.set(key, loaded)
  return getProfile(key)
}

/**
 * Save the profile online, then update the session copy.
 *
 * Throws when the server write fails, so the editor can say "not saved"
 * instead of pretending a browser-only copy is safe.
 */
export async function saveProfile(profile: Profile): Promise<Profile> {
  const key = profileKey(profile.email)
  const next: Profile = { ...profile, email: key, tagline: 'Job Seeker', updatedAt: Date.now() }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Sign in again to save your profile.')

  const { error } = await supabase
    .from('job_profiles')
    .upsert({
      user_id: user.id,
      email: key,
      data: next,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  if (error) throw new Error('Your profile could not be saved online. Check your connection and try again.')

  profiles.set(key, next)
  return next
}

export function newEducation(): Education {
  return {
    id: 'e_' + Math.random().toString(36).slice(2, 8),
    degree: '',
    institution: '',
    field: '',
    year: '',
  }
}

export function newExperience(): Experience {
  return {
    id: 'x_' + Math.random().toString(36).slice(2, 8),
    title: '',
    company: '',
    duration: '',
    description: '',
  }
}
