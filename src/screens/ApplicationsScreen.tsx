import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, EmptyState } from '../components/ui'
import { useBackHandler } from '../components/useBackHandler'
import { getCachedMyApplications, listMyApplications, type ApplicationRecord } from '../data/apply'

/**
 * "My applications" — the page opened by the Account tab's button. It lists
 * every email / WhatsApp application the signed-in user has sent, with the job
 * it was sent for. It paints from the last known list at once and refreshes in
 * the background.
 *
 * The page owns the phone's back button while it is open, so the back gesture
 * returns to the Account page.
 */
export function ApplicationsScreen({ onClose, onBrowseJobs }: { onClose: () => void; onBrowseJobs: () => void }) {
  const [applications, setApplications] = useState<ApplicationRecord[]>(() => getCachedMyApplications() ?? [])
  const [loaded, setLoaded] = useState(() => getCachedMyApplications() !== null)
  const [error, setError] = useState<string | null>(null)

  useBackHandler(true, onClose)

  const refresh = useCallback(async () => {
    try {
      setApplications(await listMyApplications())
      setError(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Applications could not be loaded.'
      // The application history is created by supabase/applications.sql. Until
      // that has run there is no history to show, but the application itself is
      // still delivered — so say that plainly instead of showing the raw error.
      setError(/list_my_applications|record_application|schema cache|does not exist|could not find/i.test(message)
        ? 'Your application history is being enabled on the platform. Applications you send are still delivered to the manager; they will appear here shortly.'
        : message)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh])

  return (
    <div className="fixed inset-0 z-40 bg-slate-50 overflow-y-auto">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="secondary" className="px-3 py-2 text-sm" onClick={onClose}>← Back</Button>
          <div className="min-w-0 flex-1">
            <div className="text-base font-extrabold text-slate-900 truncate">My applications</div>
            <div className="text-xs text-slate-600">Jobs you applied to from this account</div>
          </div>
          <Badge color="slate">{loaded ? `${applications.length} sent` : 'Loading…'}</Badge>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-4 pb-28 space-y-3">
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800 ring-1 ring-red-200">{error}</p>}

        {!loaded && !error ? (
          <p role="status" className="text-sm text-slate-600">Loading your applications…</p>
        ) : applications.length === 0 && !error ? (
          <Card className="p-4">
            <EmptyState
              icon="📄"
              title="No applications yet"
              subtitle="Open a job and tap Apply — every application you send is listed here."
            />
            <Button className="w-full" onClick={onBrowseJobs}>Browse jobs</Button>
          </Card>
        ) : (
          applications.map((application) => (
            <Card key={application.id} className="p-3">
              <div className="flex items-start gap-3">
                <span aria-hidden className="text-xl">{application.channel === 'email' ? '✉️' : '💬'}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900 truncate">{application.jobTitle}</div>
                  <div className="text-sm text-slate-700 truncate">
                    {application.company || 'Company confidential'} · {application.channel === 'email' ? 'Email' : 'WhatsApp'} to{' '}
                    {application.manager || 'manager'}
                  </div>
                  {application.to && (
                    <div className="text-xs text-slate-600 truncate">Sent to {application.to}</div>
                  )}
                  <div className="text-xs text-slate-500 mt-0.5">
                    {application.sentAt ? new Date(application.sentAt).toLocaleString('en-IN') : '—'}
                    {application.resumeFileName ? ` · resume: ${application.resumeFileName}` : ''}
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </main>
    </div>
  )
}
