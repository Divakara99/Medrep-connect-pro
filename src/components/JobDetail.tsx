import { Button, Badge, Modal } from './ui'
import type { Job } from '../data/jobs'
import { CREATOR } from '../data/creator'

function resolveChannel(job: Job): { channel: 'email' | 'whatsapp'; target: string } {
  const email = (job.managerEmail || '').trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { channel: 'email', target: email }
  return { channel: 'whatsapp', target: job.contact || '' }
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const h = Math.floor(d / 3600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h} hours ago`
  const days = Math.floor(h / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

export function JobDetail({
  job,
  unlocked,
  onClose,
  onSubscribe,
  onApply,
}: {
  job: Job | null
  unlocked: boolean
  onClose: () => void
  onSubscribe: () => void
  onApply: (j: Job) => void
}) {
  const { channel, target: _target } = job ? resolveChannel(job) : { channel: 'email' as const, target: '' }
  return (
    <Modal open={!!job} onClose={onClose} title={job?.title}>
      {job && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white grid place-items-center font-bold shrink-0">
              {unlocked ? job.company.slice(0, 2).toUpperCase() : '🔒'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge color="brand">{job.category}</Badge>
                {job.pinned && <Badge color="amber">★ Pinned priority</Badge>}
              </div>
              <div className="text-sm text-slate-600 mt-1">
                {unlocked ? (
                  <>
                    {job.company} · {timeAgo(job.postedAt)}
                  </>
                ) : (
                  <>
                    Company hidden · {timeAgo(job.postedAt)}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Role" value={job.title} />
            <Field label="Location" value={job.location} />
            <Field label="Experience" value={job.experience || '—'} />
            <Field label="Salary" value={job.salary || '—'} />
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Description</div>
            <div className="text-sm text-slate-800 leading-relaxed">{job.description || 'No description provided.'}</div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 p-3 relative overflow-hidden">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Hiring company & contact</div>
            {!unlocked ? (
              <>
                <div className="text-sm text-slate-600">Company and contact are available with an active plan.</div>
                <div className="absolute inset-0 grid place-items-center bg-white/60 backdrop-blur-sm">
                  <div className="text-center">
                    <div className="text-2xl">🔒</div>
                    <div className="text-sm font-semibold text-slate-900">Subscribe to unlock company & contact</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-800 space-y-1">
                <div><span className="font-semibold">Company:</span> {job.company}</div>
                <div><span className="font-semibold">Manager:</span> {job.manager || '—'}</div>
                <div><span className="font-semibold">Email:</span> <span className="text-brand-700 font-bold break-all">{job.managerEmail || CREATOR.adminEmail}</span></div>
                <div><span className="font-semibold">Phone:</span> {job.contact || '—'}</div>
              </div>
            )}
          </div>

          {!unlocked ? (
            <Button className="w-full" variant="accent" onClick={onSubscribe}>
              💎 Subscribe to unlock & apply
            </Button>
          ) : (
            <Button className="w-full" onClick={() => onApply(job)}>
              {channel === 'email' ? '✉️ Apply via Email to Manager' : '💬 Apply via WhatsApp (no email on file)'}
            </Button>
          )}
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </Modal>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl ring-1 ring-slate-200 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900 truncate">{value}</div>
    </div>
  )
}

export function ApplyConfirmSheet({
  job,
  channel,
  target,
  onClose,
  onConfirm,
}: {
  job: Job | null
  channel: 'email' | 'whatsapp'
  target: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open={!!job} onClose={onClose} title={channel === 'email' ? 'Send application email' : 'Send WhatsApp message'}>
      {job && (
        <div className="space-y-4">
          {channel === 'email' ? (
            <div className="rounded-xl bg-gradient-to-br from-brand-50 to-indigo-50 p-4 ring-1 ring-brand-200 text-sm text-slate-800">
              <div className="flex items-start gap-2">
                <div className="text-xl">✉️</div>
                <div>
                  Tapping <span className="font-bold">Send</span> opens your default mail app (Gmail / Outlook / Apple Mail) with a fully pre-filled application addressed to the hiring manager.
                  <span className="block mt-1 text-emerald-800 font-semibold">
                    ✓ All your Job Seeker profile details are auto-filled. A copy is CC'd to MedRep Connect for tracking.
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-green-50 p-4 ring-1 ring-emerald-200 text-sm text-slate-800">
              <div className="flex items-start gap-2">
                <div className="text-xl">💬</div>
                <div>
                  No manager email is on file for this vacancy — so tapping <span className="font-bold">Send</span> opens WhatsApp with a pre-filled message to the manager.
                  <span className="block mt-1 text-emerald-800 font-semibold">
                    ✓ WhatsApp is the fallback only when email isn't available.
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl ring-1 ring-slate-200 p-3 text-sm space-y-1">
            {channel === 'email' ? (
              <>
                <div><span className="font-semibold text-slate-900">To:</span> {target || CREATOR.adminEmail}</div>
                <div><span className="font-semibold text-slate-900">Cc:</span> {CREATOR.adminEmail}</div>
                <div><span className="font-semibold text-slate-900">Subject:</span> Application for {job.title} at {job.company}</div>
              </>
            ) : (
              <>
                <div><span className="font-semibold text-slate-900">WhatsApp to:</span> {target || job.contact}</div>
                <div><span className="font-semibold text-slate-900">Manager:</span> {job.manager || '—'}</div>
              </>
            )}
            <div><span className="font-semibold text-slate-900">Role:</span> {job.title}</div>
            <div><span className="font-semibold text-slate-900">Location:</span> {job.location}</div>
          </div>

          <div className="text-xs text-slate-500">
            {channel === 'email'
              ? 'Your mail app will open — simply tap Send after reviewing.'
              : 'WhatsApp will open with a pre-formatted message — tap Send to deliver it to the manager.'}
            {' '}Make sure your Account profile is up-to-date.
          </div>

          <Button className="w-full" onClick={onConfirm}>
            {channel === 'email' ? '✉️ Open mail app & send' : '💬 Open WhatsApp & send'}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>Cancel</Button>
        </div>
      )}
    </Modal>
  )
}
