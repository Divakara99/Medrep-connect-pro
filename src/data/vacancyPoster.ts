import { supabase } from './supabase'

const BUCKET = 'vacancy-posters'
export const MAX_VACANCY_POSTER_BYTES = 8 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type PosterUploadResult =
  | { ok: true; path: string }
  | { ok: false; error: string }

function fileExtension(file: File): string {
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  return 'jpg'
}

/** Store a public-facing vacancy flyer in the private bucket. Job visibility RPCs
 * return its object path only to users entitled to the full contact details. */
export async function uploadVacancyPoster(file: File): Promise<PosterUploadResult> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, error: 'Use a JPG, PNG or WebP vacancy poster image.' }
  }
  if (file.size <= 0 || file.size > MAX_VACANCY_POSTER_BYTES) {
    return { ok: false, error: 'Choose a poster image up to 8 MB.' }
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'Sign in again before attaching a vacancy poster.' }

  const path = `${user.id}/${crypto.randomUUID()}.${fileExtension(file)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  })
  if (error) {
    const missingBucket = /bucket not found|not found/i.test(error.message)
    return {
      ok: false,
      error: missingBucket
        ? 'Poster storage is not set up yet. Run supabase/vacancy_posters.sql, then try again.'
        : error.message || 'The vacancy poster could not be uploaded. Try again.',
    }
  }
  return { ok: true, path }
}

/** Remove an uploaded poster after its job record has been updated. */
export async function deleteVacancyPoster(path: string): Promise<void> {
  if (!path) return
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.app_metadata?.role === 'vacancy_editor') {
    const { error } = await supabase.rpc('delete_unattached_vacancy_poster', { p_path: path })
    if (error) throw new Error(error.message || 'The unattached poster could not be removed.')
    return
  }
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw new Error(error.message || 'The old vacancy poster could not be removed.')
}

/** Create a short-lived URL. Storage RLS re-checks the user's entitlement. */
export async function vacancyPosterSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 900)
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'The vacancy poster could not be opened.')
  }
  return data.signedUrl
}
