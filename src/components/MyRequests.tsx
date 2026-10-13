import { useCallback, useEffect, useState } from 'react'
import { Badge, Card } from './ui'
import {
  getCachedSupportRequests,
  listMySupportRequests,
  ticketNumber,
  type SupportRequest,
  type SupportStatus,
} from '../data/supportRequests'
import { reasonLabel } from '../data/refundCheck'

const STATUS_LABEL: Record<SupportStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
}

const STATUS_COLOR: Record<SupportStatus, 'amber' | 'brand' | 'green'> = {
  open: 'amber',
  in_progress: 'brand',
  resolved: 'green',
}

/**
 * "My requests": refund and support requests raised from AI Help, with their
 * status and the administrator's reply. Paints from the last known list at
 * once and refreshes in the background.
 */
export function MyRequests() {
  const [requests, setRequests] = useState<SupportRequest[]>(() => getCachedSupportRequests() ?? [])
  const [loaded, setLoaded] = useState(() => getCachedSupportRequests() !== null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setRequests(await listMySupportRequests())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Requests could not be loaded.')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void refresh()
    })
  }, [refresh])

  const open = requests.filter((r) => r.status !== 'resolved').length

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="text-sm font-bold text-slate-900">My requests</div>
        <Badge color="slate">{loaded ? `${open} open · ${requests.length} total` : 'Loading…'}</Badge>
      </div>
      <p className="text-[11px] text-slate-500 mb-2">
        Refund and support requests you raise from AI Help. The administrator's reply appears here.
      </p>
      {error ? (
        <p role="alert" className="text-xs font-semibold text-red-800">{error}</p>
      ) : !loaded ? (
        <p role="status" className="text-xs text-slate-600">Loading your requests…</p>
      ) : requests.length === 0 ? (
        <p className="text-xs text-slate-600">No requests yet. Open AI Help and choose "Payment &amp; refunds" or "I need support".</p>
      ) : (
        <div className="space-y-2">
          {requests.map((request) => (
            <div key={request.id} className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {request.kind === 'refund' ? '💳 Refund' : '🛟 Support'} #{ticketNumber(request.id)} · {request.subject}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {new Date(request.createdAt).toLocaleString('en-IN')}
                    {request.reasonCode ? ` · ${reasonLabel(request.reasonCode)}` : ''}
                  </div>
                </div>
                <Badge color={STATUS_COLOR[request.status]}>{STATUS_LABEL[request.status]}</Badge>
              </div>
              <p className="text-xs text-slate-700 mt-2 whitespace-pre-wrap line-clamp-4">{request.message}</p>
              {request.adminReply ? (
                <div className="mt-2 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 p-2">
                  <div className="text-[11px] font-bold text-emerald-900">Reply from admin</div>
                  <p className="text-xs text-emerald-900 whitespace-pre-wrap">{request.adminReply}</p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 mt-2">
                  {request.status === 'resolved' ? 'Closed by the administrator.' : 'Waiting for the administrator.'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
