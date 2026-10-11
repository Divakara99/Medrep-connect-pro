import { useEffect, useState } from 'react'
import { Badge, Button, Card, EmptyState, Modal } from './ui'
import { getNotificationsForUser, markAllRead, markOneRead, unreadCount, type Notification } from '../data/notifications'

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60_000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}

function typeIcon(t: Notification['type']) {
  switch (t) {
    case 'job': return '💼'
    case 'plan': return '💎'
    case 'payment': return '💳'
    case 'system': return '⚙️'
    default: return '🔔'
  }
}

function getReadSince(email: string): number {
  try {
    const all = JSON.parse(localStorage.getItem('mrc_notif_read_v1') || '{}') as Record<string, number>
    return all[email.toLowerCase()] ?? 0
  } catch {
    return 0
  }
}

export function NotificationsPanel({
  open,
  onClose,
  email,
}: {
  open: boolean
  onClose: () => void
  email: string
}) {
  const [list, setList] = useState<Notification[]>([])
  const [count, setCount] = useState(0)
  const [readSince, setReadSince] = useState(0)

  const refresh = () => {
    setList(getNotificationsForUser(email))
    setCount(unreadCount(email))
    setReadSince(getReadSince(email))
  }

  useEffect(() => {
    if (open) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, email])

  useEffect(() => {
    if (!open) return
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, email])

  return (
    <Modal open={open} onClose={onClose} title={`Notifications${count > 0 ? ` (${count} new)` : ''}`}>
      <div className="space-y-3 -mx-1">
        <div className="flex items-center justify-between px-1">
          <div className="text-xs text-slate-500">AI-generated updates from Mr. Divakar Reddy & the MedRep team</div>
          {count > 0 && (
            <Button variant="secondary" onClick={() => { markAllRead(email); refresh() }}>
              Mark all read
            </Button>
          )}
        </div>
        {list.length === 0 ? (
          <EmptyState icon="🔔" title="No notifications yet" subtitle="You'll see job alerts, plan updates, and platform news here." />
        ) : (
          list.map((n) => {
            const isNew = n.createdAt > readSince
            return (
              <Card key={n.id} className={`p-3 ring-1 ${isNew ? 'ring-brand-300 bg-brand-50/40' : 'ring-slate-200'}`}>
                <div className="flex items-start gap-3">
                  <div className="text-xl leading-none mt-0.5">{typeIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-slate-900 text-sm leading-snug">{n.title}</div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isNew && <Badge color="brand">New</Badge>}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>{n.from}</span>
                      <span>·</span>
                      <span>{timeAgo(n.createdAt)}</span>
                    </div>
                    <div className="text-sm text-slate-700 mt-1.5 whitespace-pre-wrap leading-relaxed">
                      {n.body}
                    </div>
                    {isNew && (
                      <button
                        className="text-xs font-semibold text-brand-600 mt-2 hover:underline"
                        onClick={() => { markOneRead(email, n.id); refresh() }}
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </Modal>
  )
}
