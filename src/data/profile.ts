import { mirror } from './supabase'
import { read, write } from './storage'

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

const PROFILES_KEY = 'mrc_profiles_v1'

export function profileKey(email: string) {
  return email.trim().toLowerCase()
}

export function getProfile(email: string): Profile {
  const all = read<Record<string, Profile>>(PROFILES_KEY, {})
  const key = profileKey(email)
  return (
    all[key] || {
      email: key,
      tagline: 'Job Seeker',
      education: [],
      experience: [],
    }
  )
}

export function saveProfile(profile: Profile): Profile {
  const all = read<Record<string, Profile>>(PROFILES_KEY, {})
  const key = profileKey(profile.email)
  const next: Profile = { ...profile, tagline: 'Job Seeker', updatedAt: Date.now() }
  all[key] = next
  write(PROFILES_KEY, all)
  mirror('profiles', { ...next, id: key })
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
