import { useCallback, useEffect, useState } from 'react'
import { Badge, Card } from './ui'
import { listMyApplications, type ApplicationRecord } from '../data/apply'

/**
 * "My applications": every email / WhatsApp application the user has sent.
 * Shown in Account, right after the profile details, so the history stays
 * reachable now that Applications is no longer a bottom-nav tab.
 */
export function ApplicationHistory() {
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
  )
}
