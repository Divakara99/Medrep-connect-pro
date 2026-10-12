import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Card } from '../components/ui'
import type { User } from '../data/auth'
import {
  RESUME_RETENTION_DAYS,
  deleteResume,
  listResumes,
  resumeDownloadUrl,
  retentionLabel,
  uploadResume,
  type ResumeRecord,
} from '../data/resume'
import { listMyApplications, type ApplicationRecord } from '../data/apply'

/**
 * Resume + application history.
 *
 * Uploading happens in place: the file goes to private Supabase Storage, the
 * confirmation appears on this screen, and the user is never navigated away.
 */
export function ApplicationsScreen({
  user,
  onResumeChange,
}: {
  user: User
  onResumeChange: (resume: ResumeRecord | null) => void
}) {
  const [resume, setResume] = useState<ResumeRecord | null>(null)
  const [resumesLoading, setResumesLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [applicationsError, setApplicationsError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const stored = await listResumes()
      setResume(stored[0] ?? null)
      onResumeChange(stored[0] ?? null)
    } catch (cause) {
      setNotice({
        kind: 'error',
        text: cause instanceof Error ? cause.message : 'Resume storage is unavailable right now.',
      })
    } finally {
      setResumesLoading(false)
    }

    try {
      setApplications(await listMyApplications())
      setApplicationsError(null)
    } catch (cause) {
      setApplicationsError(cause instanceof Error ? cause.message : 'Applications could not be loaded.')
    }
  }, [onResumeChange])

  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh])

  async function onFile(file: File | undefined) {
    if (!file || uploading) return
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
    onResumeChange(result.resume)
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
    onResumeChange(null)
    setNotice({ kind: 'success', text: 'Resume deleted from secure storage.' })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-28 pt-4 space-y-4">
      <Card className="p-4 bg-gradient-to-br from-brand-50 to-indigo-50 border-brand-200">
        <div className="text-[11px] font-bold uppercase tracking-widest text-brand-700">Applications</div>
        <h1 className="text-lg font-extrabold text-slate-900 mt-0.5">Resume & application history</h1>
        <p className="text-sm text-slate-700 mt-1">
          Upload your resume once. It is kept in private storage — only you can open it — and every application you send
          is listed below.
        </p>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Resume / CV</div>
            <div className="text-sm text-slate-700 mt-0.5">
              PDF, DOC or DOCX · max 2 MB · private · automatically deleted after {RESUME_RETENTION_DAYS} days.
            </div>
          </div>
          <span aria-hidden className="text-2xl">📎</span>
        </div>

        {resumesLoading ? (
          <div role="status" className="text-sm font-semibold text-slate-600">Checking secure storage…</div>
        ) : resume ? (
          <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-3 space-y-2">
            <div className="flex items-center gap-3">
              <span aria-hidden className="text-xl">✅</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900 truncate">{resume.fileName}</div>
                <div className="text-xs text-slate-600">
                  {Math.max(1, Math.round(resume.size / 1024))} KB · uploaded {new Date(resume.uploadedAt).toLocaleDateString('en-IN')}
                </div>
              </div>
              <Badge color="green">Stored securely</Badge>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" className="px-3 py-2 text-xs" onClick={() => { void download() }}>
                ⬇ Download
              </Button>
              <Button variant="secondary" className="px-3 py-2 text-xs" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : '↻ Replace'}
              </Button>
              <Button variant="danger" className="px-3 py-2 text-xs" onClick={() => { void remove() }}>
                🗑 Delete
              </Button>
            </div>
            <p className="text-[11px] text-slate-600">
              Auto-deleted on <span className="font-semibold">{retentionLabel(resume)}</span>. Download a copy before then if
              you need it.
            </p>
          </div>
        ) : (
          <Button onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading securely…' : '⬆ Upload resume'}
          </Button>
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
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${notice.kind === 'success' ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200' : 'bg-red-50 text-red-900 ring-1 ring-red-200'}`}
          >
            {notice.text}
          </p>
        )}

        <p className="text-[11px] text-slate-500">
          Your resume is never published, never shown to other users, and is not readable by platform administrators. When
          you apply, a secure download link lets you attach it in your own mail app — browsers cannot attach files to a
          mail link automatically.
        </p>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="text-sm font-bold text-slate-900">My applications</div>
          <Badge color="slate">{applications.length} sent</Badge>
        </div>
        {applicationsError ? (
          <p role="alert" className="text-sm font-semibold text-red-800">{applicationsError}</p>
        ) : applications.length === 0 ? (
          <p className="text-sm text-slate-600">No applications yet. Open a job and tap Apply — it will be listed here.</p>
        ) : (
          <div className="space-y-2">
            {applications.map((application) => (
              <div key={application.id} className="rounded-xl ring-1 ring-slate-200 p-3">
                <div className="flex items-start gap-2">
                  <span aria-hidden className="text-lg">{application.channel === 'email' ? '✉️' : '💬'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {application.jobTitle}
                      {application.company ? ` · ${application.company}` : ''}
                    </div>
                    <div className="text-xs text-slate-600 truncate">
                      {application.channel === 'email' ? 'Email' : 'WhatsApp'} to {application.manager || 'manager'}
                      {application.to ? ` (${application.to})` : ''}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {application.sentAt ? new Date(application.sentAt).toLocaleString('en-IN') : '—'}
                      {application.resumeFileName ? ` · resume: ${application.resumeFileName}` : ''}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="text-center text-[11px] text-slate-400">Signed in as {user.email}</p>
    </div>
  )
}
