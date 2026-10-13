import { useCallback, useEffect, useState } from 'react'
import { Badge, Card } from '../components/ui'
import type { User } from '../data/auth'
import { RESUME_RETENTION_DAYS, retentionLabel, type ResumeRecord } from '../data/resume'
import { listMyApplications, type ApplicationRecord } from '../data/apply'

/**
 * Applications: the history of every email / WhatsApp application the user has
 * sent. The resume itself is managed in Account → Profile details; this screen
 * only shows which resume is on file so the user knows what gets attached.
 */
export function ApplicationsScreen({
  user,
  resume,
}: {
  user: User
  resume: ResumeRecord | null
}) {
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [applicationsError, setApplicationsError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setApplications(await listMyApplications())
      setApplicationsError(null)
    } catch (cause) {
      setApplicationsError(cause instanceof Error ? cause.message : 'Applications could not be loaded.')
    }
  }, [])

  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh])

  return (
    <div className="max-w-3xl mx-auto px-4 pb-28 pt-4 space-y-4">
      <Card className="p-4 bg-gradient-to-br from-brand-50 to-indigo-50 border-brand-200">
        <div className="text-[11px] font-bold uppercase tracking-widest text-brand-700">Applications</div>
        <h1 className="text-lg font-extrabold text-slate-900 mt-0.5">Every application you have sent</h1>
        <p className="text-sm text-slate-700 mt-1">
          Each email or WhatsApp application you send from a job is listed below, with the resume that was attached.
        </p>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Resume on file</div>
          {resume ? <Badge color="green">Stored securely</Badge> : <Badge color="amber">None</Badge>}
        </div>
        {resume ? (
          <>
            <div className="text-sm font-semibold text-slate-900 truncate">{resume.fileName}</div>
            <p className="text-xs text-slate-600">
              Auto-deleted on <span className="font-semibold">{retentionLabel(resume)}</span>. Manage it in{' '}
              <span className="font-bold">Account → Profile details</span>.
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-700">
            No resume uploaded yet. Add one in <span className="font-bold">Account → Profile details</span> (PDF, DOC or
            DOCX, max 2 MB, kept privately for {RESUME_RETENTION_DAYS} days) so it can be attached to your applications.
          </p>
        )}
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
