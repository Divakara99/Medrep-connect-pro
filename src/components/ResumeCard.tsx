import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card } from './ui'
import {
  RESUME_RETENTION_DAYS,
  deleteResume,
  getCachedResumes,
  listResumes,
  resumeDownloadUrl,
  retentionLabel,
  uploadResume,
  type ResumeRecord,
} from '../data/resume'

/**
 * Resume upload, download, replace and delete.
 *
 * Lives in Account → Profile details. The file goes to private Supabase Storage,
 * the confirmation appears on this card, and the user is never navigated away.
 * `onResumeChange` keeps the app-wide resume (used by the apply sheet) in sync.
 */
export function ResumeCard({ onResumeChange }: { onResumeChange?: (resume: ResumeRecord | null) => void }) {
  // Start from the last known list so the card paints at once; the fresh list
  // replaces it in the background.
  const [resume, setResume] = useState<ResumeRecord | null>(() => getCachedResumes()?.[0] ?? null)
  const [resumesLoading, setResumesLoading] = useState(() => getCachedResumes() === null)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [storageReady, setStorageReady] = useState(true)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const stored = await listResumes()
      setResume(stored[0] ?? null)
      onResumeChange?.(stored[0] ?? null)
      setStorageReady(true)
    } catch (cause) {
      // The private bucket/table are created by supabase/resumes.sql. Until
      // that has run there is nothing to upload to, so say so plainly instead
      // of offering a button that can only fail.
      const message = cause instanceof Error ? cause.message : 'Resume storage is unavailable right now.'
      const notEnabled = /resume_documents|relation|does not exist|could not find/i.test(message)
      setStorageReady(!notEnabled)
      setNotice({
        kind: notEnabled ? 'info' : 'error',
        text: notEnabled
          ? 'Secure resume storage is being enabled on the platform. Your upload will be available shortly — nothing is lost.'
          : message,
      })
    } finally {
      setResumesLoading(false)
    }
  }, [onResumeChange])

  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh])

  async function onFile(file: File | undefined) {
    if (!file || uploading || !storageReady) return
    setUploading(true)
    setNotice(null)
    const result = await uploadResume(file)
    setUploading(false)
    if (!result.ok) {
      setNotice({ kind: 'error', text: result.error })
      return
    }
    // Replace the previous copy so only one current resume is kept.
    if (resume && resume.id !== result.resume.id) await deleteResume(resume)
    setResume(result.resume)
    onResumeChange?.(result.resume)
    setNotice({
      kind: 'success',
      text: `Resume uploaded — ${result.resume.fileName}. It is stored privately and only you can open it.`,
    })
  }

  async function download() {
    if (!resume) return
    const result = await resumeDownloadUrl(resume)
    if (!result.ok) {
      setNotice({ kind: 'error', text: result.error })
      return
    }
    const anchor = document.createElement('a')
    anchor.href = result.url
    anchor.download = resume.fileName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  async function remove() {
    if (!resume) return
    const result = await deleteResume(resume)
    if (!result.ok) {
      setNotice({ kind: 'error', text: result.error })
      return
    }
    setResume(null)
    onResumeChange?.(null)
    setNotice({ kind: 'success', text: 'Resume deleted from secure storage.' })
  }

  return (
    <Card className="px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Resume / CV</div>
        <span className="text-[10px] text-slate-400">Private · deleted after {RESUME_RETENTION_DAYS} days</span>
      </div>

      {resumesLoading ? (
        <div role="status" className="text-[11px] font-semibold text-slate-600">Checking secure storage…</div>
      ) : resume ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span aria-hidden className="text-sm">✅</span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-slate-900 truncate">{resume.fileName}</div>
            <div className="text-[10px] text-slate-500">
              Auto-deleted {retentionLabel(resume)}
            </div>
          </div>
          <Button variant="secondary" className="px-2 py-1 text-[11px]" onClick={() => { void download() }}>⬇ Download</Button>
          <Button variant="secondary" className="px-2 py-1 text-[11px]" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '↻ Replace'}
          </Button>
          <Button variant="danger" className="px-2 py-1 text-[11px]" onClick={() => { void remove() }}>🗑</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 text-[11px] text-slate-600">PDF, DOC or DOCX · max 2 MB</div>
          <Button className="px-2.5 py-1 text-[11px]" onClick={() => fileInput.current?.click()} disabled={uploading || !storageReady}>
            {uploading ? 'Uploading…' : storageReady ? '⬆ Upload' : 'Unavailable'}
          </Button>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = '' }}
      />

      {notice && (
        <p
          role="status"
          className={`rounded-md px-2 py-1 text-[11px] font-semibold ${notice.kind === 'success' ? 'bg-emerald-50 text-emerald-900' : notice.kind === 'info' ? 'bg-brand-50 text-brand-900' : 'bg-red-50 text-red-900'}`}
        >
          {notice.text}
        </p>
      )}

      <p className="text-[10px] leading-snug text-slate-500">
        Only you can open your resume. Attach it from your mail app when you apply.
      </p>
    </Card>
  )
}
