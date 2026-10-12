import { supabase } from './supabase'

/**
 * Private resume storage.
 *
 * The file is uploaded to a PRIVATE Supabase Storage bucket and described by a
 * row in public.resume_documents. Both are restricted to the signed-in owner by
 * RLS — per the agreed rules nobody else (not even an administrator) can read a
 * candidate's resume. Nothing is written to browser storage: the previous
 * localStorage copy is purged below.
 *
 * Downloads use a short-lived signed URL minted for the owner, so there is no
 * permanent link to leak.
 */
export type ResumeRecord = {
  id: string
  fileName: string
  mimeType: string
  size: number
  storagePath: string
  uploadedAt: number
  expiresAt: number
}

export const RESUME_RETENTION_DAYS = 30
const BUCKET = 'resumes'
const MAX_RESUME_BYTES = 2_097_152 // matches the bucket's server-side limit
const ALLOWED = /\.(pdf|doc|docx)$/i
const ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

/**
 * Browsers report an empty (or wrong) MIME type for some .doc/.docx files, and
 * the bucket only accepts the three document types above. Resolve the type from
 * the extension so a valid resume is never rejected by the bucket policy.
 */
function resolveContentType(file: File): string {
  if (ALLOWED_MIME.includes(file.type)) return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (name.endsWith('.doc')) return 'application/msword'
  return file.type || 'application/octet-stream'
}
const SIGNED_URL_SECONDS = 300

// The earlier build kept the resume as a data: URL in localStorage, where any
// script or shared device could read it. Purge every copy on start-up.
try {
  const legacy: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith('mrc_resume_v1')) legacy.push(key)
  }
  legacy.forEach((key) => localStorage.removeItem(key))
} catch {
  /* storage may be unavailable in private mode */
}

type ResumeRow = {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number | string
  storage_path: string
  uploaded_at: string
  expires_at: string
}

function toResumeRecord(row: ResumeRow): ResumeRecord {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: Number(row.size_bytes),
    storagePath: row.storage_path,
    uploadedAt: new Date(row.uploaded_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
  }
}

function failureMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message
    if (typeof value === 'string' && value.trim()) {
      if (/row-level security|permission denied/i.test(value)) {
        return 'Your session does not allow resume access. Please sign in again.'
      }
      return value
    }
  }
  return fallback
}

async function currentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

/** The signed-in user's resumes, newest first. */
export async function listResumes(): Promise<ResumeRecord[]> {
  const { data, error } = await supabase
    .from('resume_documents')
    .select('id,file_name,mime_type,size_bytes,storage_path,uploaded_at,expires_at')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(failureMessage(error, 'Resumes could not be loaded.'))
  return ((data ?? []) as unknown as ResumeRow[]).map(toResumeRecord)
}

export async function getLatestResume(): Promise<ResumeRecord | null> {
  const resumes = await listResumes()
  return resumes[0] ?? null
}

export type UploadResult = { ok: true; resume: ResumeRecord } | { ok: false; error: string }

export async function uploadResume(file: File): Promise<UploadResult> {
  if (file.size > MAX_RESUME_BYTES) {
    return { ok: false, error: 'Resume is too large. Please upload a file under 2 MB.' }
  }
  if (!ALLOWED.test(file.name)) {
    return { ok: false, error: 'Upload the resume as PDF, DOC or DOCX.' }
  }
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: 'Sign in again to upload your resume.' }

  const contentType = resolveContentType(file)
  const documentId = crypto.randomUUID()
  const storagePath = `${userId}/${documentId}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType, upsert: false, cacheControl: 'no-store' })
  if (uploadError) {
    return { ok: false, error: failureMessage(uploadError, 'The resume could not be uploaded. Please try again.') }
  }

  const { error: insertError } = await supabase.from('resume_documents').insert({
    id: documentId,
    user_id: userId,
    file_name: file.name.slice(0, 160),
    mime_type: contentType,
    size_bytes: file.size,
    storage_path: storagePath,
  })
  if (insertError) {
    // Never leave an orphaned object behind in private storage.
    await supabase.storage.from(BUCKET).remove([storagePath])
    return { ok: false, error: failureMessage(insertError, 'The resume was uploaded but could not be registered. Please try again.') }
  }

  const { data, error } = await supabase
    .from('resume_documents')
    .select('id,file_name,mime_type,size_bytes,storage_path,uploaded_at,expires_at')
    .eq('id', documentId)
    .single()
  if (error || !data) {
    return { ok: false, error: failureMessage(error, 'The resume was saved but could not be confirmed. Please refresh.') }
  }
  return { ok: true, resume: toResumeRecord(data as unknown as ResumeRow) }
}

export async function deleteResume(resume: ResumeRecord): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: rowError } = await supabase.from('resume_documents').delete().eq('id', resume.id)
  if (rowError) return { ok: false, error: failureMessage(rowError, 'The resume record could not be removed.') }
  await supabase.storage.from(BUCKET).remove([resume.storagePath])
  return { ok: true }
}

/** Short-lived download link for the owner only. */
export async function resumeDownloadUrl(resume: ResumeRecord): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(resume.storagePath, SIGNED_URL_SECONDS, { download: resume.fileName })
  if (error || !data?.signedUrl) {
    return { ok: false, error: failureMessage(error, 'A secure download link could not be created.') }
  }
  return { ok: true, url: data.signedUrl }
}

export function isExpired(resume: ResumeRecord): boolean {
  return resume.expiresAt <= Date.now()
}

export function retentionLabel(resume: ResumeRecord): string {
  return new Date(resume.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
