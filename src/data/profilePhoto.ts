import { supabase } from './supabase'

const BUCKET = 'profile-photos'
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const SIGNED_URL_SECONDS = 60 * 60
const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export type ProfilePhotoUpload =
  | { ok: true; path: string; url: string }
  | { ok: false; error: string }

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

/** Upload a private photo under the signed-in user's own storage folder. */
export async function uploadProfilePhoto(file: File): Promise<ProfilePhotoUpload> {
  if (!MIME_EXTENSION[file.type]) {
    return { ok: false, error: 'Choose a JPG, PNG or WEBP profile photo.' }
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: 'Choose a profile photo under 5 MB.' }
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'Sign in again to upload your profile photo.' }

  const path = `${user.id}/${crypto.randomUUID()}.${MIME_EXTENSION[file.type]}`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' })
  if (uploadError) {
    return { ok: false, error: errorMessage(uploadError, 'The profile photo could not be uploaded.') }
  }

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS)
    if (error || !data?.signedUrl) {
      await supabase.storage.from(BUCKET).remove([path])
      return { ok: false, error: errorMessage(error, 'A secure photo preview could not be created.') }
    }
    return { ok: true, path, url: data.signedUrl }
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined)
    return { ok: false, error: errorMessage(error, 'A secure photo preview could not be created.') }
  }
}

/** Create an owner-only preview URL for a saved profile photo. */
export async function profilePhotoUrl(path: string): Promise<string | null> {
  if (!path) return null
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS)
    return error ? null : data?.signedUrl ?? null
  } catch {
    return null
  }
}

/** Remove an obsolete private object after the profile has been saved. */
export async function deleteProfilePhoto(path: string): Promise<void> {
  if (!path) return
  try {
    await supabase.storage.from(BUCKET).remove([path])
  } catch {
    // A failed cleanup leaves only an inaccessible private object; it must not
    // undo the already-saved replacement photo.
  }
}
