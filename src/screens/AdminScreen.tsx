import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Input, Label, Modal, Select, Textarea } from '../components/ui'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Wordmark } from '../components/Logo'
import { CREATOR } from '../data/creator'
import { APP_VERSION_LABEL } from '../data/version'
import { currentUser, deleteUserAccount, getUsers, refreshAdminUsers, type User } from '../data/auth'
import {
  addJob,
  CATEGORIES,
  deleteJob,
  getJobs,
  sortedJobs,
  togglePin,
  updateJob,
  type Job,
} from '../data/jobs'
import { getPlans, savePlans, type Plan } from '../data/plans'
import {
  getPayments,
  refreshPayments,
  reviewManualUpiPayment,
  type PaymentRecord,
} from '../data/payments'
import { getTickets, updateTicket, type Ticket } from '../data/tickets'
import { getApplicationQueue, type ApplicationRecord } from '../data/apply'
import { broadcast } from '../data/notifications'
import { reviewPlatformMessage, type Review } from '../data/aiPolish'
import { getSyncStatus } from '../data/supabase'

type AdminTab = 'dashboard' | 'vacancies' | 'plans' | 'payments' | 'applications' | 'tickets' | 'users' | 'profile'

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'vacancies', label: 'Vacancies', icon: '💼' },
  { id: 'plans', label: 'Plans', icon: '💎' },
  { id: 'payments', label: 'Payments', icon: '💳' },
  { id: 'applications', label: 'Applications', icon: '✉️' },
  { id: 'tickets', label: 'Tickets', icon: '🎫' },
  { id: 'users', label: 'Users', icon: '👥' },
  { id: 'profile', label: 'Profile', icon: '👤' },
]

type UserFilter = 'all' | 'active' | 'free'

function useCurrentTime() {
  const [now, setNow] = useState(0)
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const firstTick = window.setTimeout(refresh, 0)
    const interval = window.setInterval(refresh, 60_000)
    return () => {
      window.clearTimeout(firstTick)
      window.clearInterval(interval)
    }
  }, [])
  return now
}

export function AdminScreen({ onExit }: { onExit: () => void }) {
  const [tab, setTab] = useState<AdminTab>('dashboard')
  const [usersFilter, setUsersFilter] = useState<UserFilter>('all')
  const [version, setVersion] = useState(0) // re-render trigger after mutations
  const bump = () => setVersion((v) => v + 1)

  useEffect(() => {
    let active = true
    void refreshAdminUsers()
      .then(() => { if (active) setVersion((v) => v + 1) })
      .catch(() => undefined)
    void refreshPayments()
      .then(() => { if (active) setVersion((v) => v + 1) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  // Navigate between admin pages (used by the Dashboard monitor cards)
  function navigate(target: AdminTab, filter?: UserFilter) {
    if (target === 'users' && filter) setUsersFilter(filter)
    setTab(target)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen bg-slate-50" key={version}>
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Wordmark />
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
              {APP_VERSION_LABEL}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge color="red">Admin</Badge>
            <Button variant="secondary" onClick={onExit}>Exit admin</Button>
          </div>
        </div>
        {/* Horizontal scrollable tabs */}
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
            {TABS.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => navigate(t.id)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition flex items-center gap-1.5 touch-manipulation ${
                    active
                      ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 active:bg-slate-100'
                  }`}
                >
                  <span>{t.icon}</span>{t.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5">
        {tab === 'dashboard' && <DashboardTab onNavigate={navigate} />}
        {tab === 'vacancies' && <VacanciesTab onMutate={bump} />}
        {tab === 'plans' && <PlansTab onMutate={bump} />}
        {tab === 'payments' && <PaymentsTab onMutate={bump} />}
        {tab === 'applications' && <ApplicationsTab />}
        {tab === 'tickets' && <TicketsTab onMutate={bump} />}
        {tab === 'users' && <UsersTab filter={usersFilter} onFilter={setUsersFilter} />}
        {tab === 'profile' && <ProfileTab />}
      </div>
    </div>
  )
}

// -------------------- Applications --------------------
function ApplicationsTab() {
  const queue = useMemo(() => getApplicationQueue(), [])
  const [view, setView] = useState<ApplicationRecord | null>(null)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-900">✉️ Applications (Email · WhatsApp fallback)</h2>
        <Badge color="brand">{queue.length}</Badge>
      </div>
      {queue.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No applications have been submitted yet.</Card>
      ) : (
        <div className="grid gap-2">
          {queue.map((m) => (
            <Card key={m.id} className="p-3">
              {/* Info row */}
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg grid place-items-center text-lg shrink-0 ${m.channel === 'email' ? 'bg-brand-100 text-brand-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {m.channel === 'email' ? '✉️' : '💬'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-semibold text-slate-900 truncate">{m.applicantName}</div>
                    <Badge color={m.channel === 'email' ? 'brand' : 'green'}>{m.channel === 'email' ? 'Email' : 'WhatsApp'}</Badge>
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {m.jobTitle} at {m.company} → {m.manager} ({m.to})
                  </div>
                  <div className="text-[11px] text-slate-400">{new Date(m.sentAt).toLocaleString()}</div>
                </div>
              </div>
              {/* Action row — always visible on mobile */}
              <div className="flex items-center gap-2 mt-3">
                <Button variant="secondary" className="flex-1" onClick={() => setView(m)}>
                  👁 View full application
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!view} onClose={() => setView(null)} title={view?.channel === 'whatsapp' ? 'WhatsApp application' : 'Email application'}>
        {view && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500 space-y-0.5">
              <div><span className="font-semibold">Channel:</span> {view.channel === 'email' ? 'Email' : 'WhatsApp'}</div>
              <div><span className="font-semibold">To:</span> {view.to}</div>
              <div><span className="font-semibold">From (candidate):</span> {view.applicantEmail}</div>
              {view.subject && <div><span className="font-semibold">Subject:</span> {view.subject}</div>}
              <div><span className="font-semibold">When:</span> {new Date(view.sentAt).toLocaleString()}</div>
            </div>
            <pre className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3 text-xs overflow-auto whitespace-pre-wrap max-h-96 text-slate-800">{view.body}</pre>
          </div>
        )}
      </Modal>
    </div>
  )
}

// -------------------- Vacancies --------------------
function VacanciesTab({ onMutate }: { onMutate: () => void }) {
  const jobs = useMemo(() => sortedJobs(getJobs()), [])
  const [editing, setEditing] = useState<Job | null>(null)
  const [open, setOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null)

  function openNew() {
    setEditing(null)
    setOpen(true)
  }
  function openEdit(j: Job) {
    setEditing(j)
    setOpen(true)
  }
  function onSaved() {
    setOpen(false)
    onMutate()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-900">Vacancies ({jobs.length})</h2>
        <Button onClick={openNew}>+ Post vacancy</Button>
      </div>
      <div className="grid gap-2">
        {jobs.map((j) => (
          <Card key={j.id} className="p-3">
            {/* Info row */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-brand-100 text-brand-700 grid place-items-center font-bold text-sm shrink-0">
                {j.company.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-semibold text-slate-900 truncate">{j.title}</div>
                  <Badge color="brand">{j.category}</Badge>
                  {j.pinned && <Badge color="amber">★ Pinned</Badge>}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {j.company} · {j.location} · {j.salary || 'Salary not mentioned'}
                </div>
              </div>
            </div>
            {/* Action row — always visible on mobile (no side overflow) */}
            <div className="flex items-center gap-2 mt-3">
              <Button variant="secondary" className="flex-1" onClick={() => { togglePin(j.id, !j.pinned); onMutate() }}>
                {j.pinned ? '★ Unpin' : '☆ Pin'}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => openEdit(j)}>
                ✏️ Edit
              </Button>
              <Button variant="danger" className="flex-1" onClick={() => setDeleteTarget(j)}>
                🗑 Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <VacancyForm key={editing?.id ?? 'new'} job={editing} open={open} onClose={() => setOpen(false)} onSaved={onSaved} />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete vacancy?"
        message={deleteTarget ? `Are you sure you want to permanently delete "${deleteTarget.title}" at ${deleteTarget.company}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          if (deleteTarget) { deleteJob(deleteTarget.id); onMutate() }
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function VacancyForm({ job, open, onClose, onSaved }: { job: Job | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(job?.title ?? '')
  const [company, setCompany] = useState(job?.company ?? '')
  const [manager, setManager] = useState(job?.manager ?? '')
  const [contact, setContact] = useState(job?.contact ?? '')
  const [managerEmail, setManagerEmail] = useState(job?.managerEmail ?? '')
  const [location, setLocation] = useState(job?.location ?? '')
  const [category, setCategory] = useState<Exclude<Job['category'], 'All'>>(job?.category ?? 'MR')
  const [salary, setSalary] = useState(job?.salary ?? '')
  const [experience, setExperience] = useState(job?.experience ?? '')
  const [description, setDescription] = useState(job?.description ?? '')
  const [pinned, setPinned] = useState(job?.pinned ?? false)

  function save() {
    if (!title || !company || !location) {
      alert('Title, company, and location are required.')
      return
    }
    if (job) {
      updateJob(job.id, { title, company, manager, contact, managerEmail, location, category, salary, experience, description, pinned })
    } else {
      addJob({ title, company, manager, contact, managerEmail, location, category, salary, experience, description, pinned })
    }
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={job ? 'Edit vacancy' : 'Post vacancy'}>
      <div className="space-y-3">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Medical Representative" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Company</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onChange={(e) => setCategory(e.target.value as Exclude<Job['category'], 'All'>)}>
              {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Manager</Label>
            <Input value={manager} onChange={(e) => setManager(e.target.value)} />
          </div>
          <div>
            <Label>Contact (phone)</Label>
            <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="+91-…" />
          </div>
          <div>
            <Label>Manager email</Label>
            <Input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} placeholder="hr@company.com" />
          </div>
          <div>
            <Label>Location</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <Label>Salary</Label>
            <Input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="₹2-3 LPA" />
          </div>
          <div>
            <Label>Experience</Label>
            <Input value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="0-2 years" />
          </div>
          <div className="flex items-center gap-2 self-end pb-1">
            <input type="checkbox" id="pinned" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <label htmlFor="pinned" className="text-sm font-semibold text-slate-700">Pin to Priority</label>
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Button className="w-full" onClick={save}>{job ? 'Save changes' : 'Post vacancy'}</Button>
      </div>
    </Modal>
  )
}

// -------------------- Plans --------------------
function PlansTab({ onMutate }: { onMutate: () => void }) {
  const [plans, setPlans] = useState<Plan[]>(() => getPlans())

  function update(i: number, patch: Partial<Plan>) {
    const next = [...plans]
    next[i] = { ...next[i], ...patch }
    setPlans(next)
  }
  function save() {
    savePlans(plans)
    onMutate()
    alert('Plans saved.')
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-900">Plans & Pricing</h2>
        <Button onClick={save}>Save changes</Button>
      </div>
      <p className="rounded-xl bg-indigo-50 p-3 text-sm font-medium text-indigo-950 ring-1 ring-indigo-200">
        Checkout amounts and plan validity are enforced by the secure server catalog. This page can edit display text only.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {plans.map((p, i) => (
          <Card key={p.id} className="p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label>Title</Label>
                <Input value={p.title} onChange={(e) => update(i, { title: e.target.value })} />
              </div>
              <div>
                <Label>Checkout amount (₹) · fixed</Label>
                <Input type="number" value={p.price} disabled aria-label={`Fixed checkout price for ${p.title}`} />
              </div>
              <div>
                <Label>Plan validity (days) · fixed</Label>
                <Input type="number" value={p.days} disabled aria-label={`Fixed plan validity for ${p.title}`} />
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-sm pb-2">
                  <input type="checkbox" checked={!!p.popular} onChange={(e) => update(i, { popular: e.target.checked })} />
                  Popular
                </label>
              </div>
              <div className="col-span-2">
                <Label>Tagline</Label>
                <Input value={p.tagline} onChange={(e) => update(i, { tagline: e.target.value })} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

// -------------------- Payments --------------------
function PaymentsTab({ onMutate }: { onMutate: () => void }) {
  const [payments, setPayments] = useState<PaymentRecord[]>(() => getPayments())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [decision, setDecision] = useState<{ payment: PaymentRecord; approve: boolean } | null>(null)

  useEffect(() => {
    let active = true
    void refreshPayments()
      .then((records) => { if (active) setPayments(records) })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Payment records could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function review(payment: PaymentRecord, approve: boolean) {
    setReviewing(payment.id)
    setError(null)
    try {
      await reviewManualUpiPayment(payment.id, approve)
      setPayments(getPayments())
      setDecision(null)
      onMutate()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'The UPI request could not be reviewed.')
    } finally {
      setReviewing(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Payment transactions</h2>
        <p className="text-sm text-slate-700 mt-1">Razorpay plans activate after server-side capture verification. Check a manual UPI transfer in the bank account before approving its UTR.</p>
      </div>

      {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-900 ring-1 ring-red-300">{error}</div>}

      {loading && payments.length === 0 ? (
        <Card className="p-5 text-sm text-slate-700">Loading payment records…</Card>
      ) : payments.length === 0 ? (
        <Card className="p-5 text-sm text-slate-700">No payments recorded yet.</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-slate-100 text-slate-800 text-left">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">UTR</th>
                  <th className="px-3 py-2">Expiry</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const account = getUsers().find((candidate) => candidate.id === payment.userId)
                  return (
                    <tr key={payment.id} className="border-t border-slate-200">
                      <td className="px-3 py-2 text-xs text-slate-700">{new Date(payment.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2 font-semibold text-slate-900">{account?.name ?? account?.email ?? payment.userId}</td>
                      <td className="px-3 py-2 text-slate-800">{payment.planTitle ?? payment.planId} · {payment.planDays}d</td>
                      <td className="px-3 py-2 font-bold text-slate-900">₹{payment.amount}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-800">{payment.gatewayPaymentId ?? payment.txRef ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-800">{payment.utr || '—'}</td>
                      <td className="px-3 py-2 text-slate-800">{payment.expiresAt ? new Date(payment.expiresAt).toLocaleDateString() : '—'}</td>
                      <td className="px-3 py-2">
                        <Badge color={payment.status === 'success' ? 'green' : payment.status === 'pending' ? 'amber' : 'red'}>
                          {payment.manualReview ? 'UPI review needed' : payment.status === 'success' ? 'Paid' : payment.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {payment.manualReview && (
                          <div className="flex gap-2">
                            <Button variant="secondary" disabled={reviewing === payment.id} onClick={() => setDecision({ payment, approve: false })}>
                              Reject
                            </Button>
                            <Button disabled={reviewing === payment.id} onClick={() => setDecision({ payment, approve: true })}>
                              Verify & activate
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!decision}
        title={decision?.approve ? 'Verify UPI payment?' : 'Reject UPI payment?'}
        message={decision?.approve
          ? `Only continue after matching the UTR ${decision.payment.utr ?? '—'}, amount ₹${decision.payment.amount}, and date in the merchant bank account. Approval activates ${decision.payment.planDays} days from the current expiry (or now).`
          : 'Reject this manual UPI request? No subscription will be activated.'}
        confirmLabel={decision?.approve ? 'Verified — activate plan' : 'Reject request'}
        danger={decision ? !decision.approve : false}
        onConfirm={() => { if (decision) void review(decision.payment, decision.approve) }}
        onCancel={() => { if (!reviewing) setDecision(null) }}
      />
    </div>
  )
}

// -------------------- Tickets --------------------
function TicketsTab({ onMutate }: { onMutate: () => void }) {
  const tickets = getTickets()
  const [reply, setReply] = useState<Record<string, string>>({})

  function setStatus(t: Ticket, status: Ticket['status']) {
    updateTicket(t.id, { status })
    onMutate()
  }
  function sendReply(t: Ticket) {
    const text = reply[t.id]?.trim()
    if (!text) return
    updateTicket(t.id, { reply: text, status: 'resolved' })
    setReply((r) => ({ ...r, [t.id]: '' }))
    onMutate()
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">Support tickets ({tickets.length})</h2>
      {tickets.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No tickets yet. AI escalations will appear here.</Card>
      ) : (
        tickets.map((t) => (
          <Card key={t.id} className="p-3 space-y-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold text-slate-900 truncate">{t.subject}</div>
                {t.kind === 'refund' && <Badge color="red">Refund</Badge>}
                <Badge color={t.source === 'ai' ? 'purple' : 'slate'}>{t.source}</Badge>
                <Badge color={t.status === 'open' ? 'red' : t.status === 'in_progress' ? 'amber' : 'green'}>{t.status.replace('_', ' ')}</Badge>
              </div>
              <div className="text-xs text-slate-500">
                {t.name ?? '—'} · {t.email ?? '—'} · {new Date(t.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="text-sm text-slate-700 bg-slate-50 rounded-lg p-2 ring-1 ring-slate-200">{t.message}</div>
            {t.reply && (
              <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg p-2 ring-1 ring-emerald-200">
                <span className="font-semibold">Reply:</span> {t.reply}
              </div>
            )}
            {/* Action row — always visible on mobile */}
            <div className="flex items-center gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setStatus(t, 'in_progress')}>▶ Start</Button>
              <Button variant="secondary" className="flex-1" onClick={() => setStatus(t, 'resolved')}>✓ Resolve</Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Input placeholder="Type a reply…" value={reply[t.id] ?? ''} onChange={(e) => setReply((r) => ({ ...r, [t.id]: e.target.value }))} />
              <Button className="shrink-0" onClick={() => sendReply(t)}>Send</Button>
            </div>
          </Card>
        ))
      )}
    </div>
  )
}

// -------------------- Users --------------------
function UsersTab({ filter, onFilter }: { filter: UserFilter; onFilter: (f: UserFilter) => void }) {
  const [all, setAll] = useState<User[]>(getUsers)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<User | null>(null)
  const [deleting, setDeleting] = useState(false)
  const currentAdminId = currentUser()?.id

  const refreshList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAll(await refreshAdminUsers())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load account records.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void refreshAdminUsers()
      .then((users) => { if (active) setAll(users) })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load account records.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const now = useCurrentTime()
  const users = all.filter((u) => {
    const active = u.subscribedUntil && u.subscribedUntil > now
    if (filter === 'active') return active
    if (filter === 'free') return !active
    return true
  })
  const activeCount = all.filter((u) => u.subscribedUntil && u.subscribedUntil > now).length

  async function confirmDelete() {
    if (!target || deleting) return
    setDeleting(true)
    setError(null)
    const result = await deleteUserAccount(target.id)
    if (!result.ok) {
      setError(result.error)
      setDeleting(false)
      return
    }
    setAll((current) => current.filter((user) => user.id !== target.id))
    setTarget(null)
    setDeleting(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-slate-900">Registered users ({all.length})</h2>
        <Button variant="secondary" onClick={() => void refreshList()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2 ring-1 ring-red-200" role="alert">{error}</div>}
      <div className="flex gap-2 flex-wrap">
        {([['all', `All (${all.length})`], ['active', `Subscribers (${activeCount})`], ['free', `Free (${all.length - activeCount})`]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onFilter(k)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition touch-manipulation ${
              filter === k ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {loading && users.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">Loading Supabase accounts…</Card>
      ) : users.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No users in this filter.</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-slate-50 text-slate-600 text-left">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2">Subscription</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const active = u.subscribedUntil && u.subscribedUntil > now
                  const protectedAccount = u.isAdmin || u.id === currentAdminId
                  return (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {u.name}{u.isAdmin && <Badge color="red">Admin</Badge>}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{u.email}</td>
                      <td className="px-3 py-2 text-slate-700">{u.phone || '—'}</td>
                      <td className="px-3 py-2 text-slate-700">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2">
                        {active ? (
                          <Badge color="green">Active until {new Date(u.subscribedUntil!).toLocaleDateString()}</Badge>
                        ) : (
                          <Badge color="slate">Free</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {protectedAccount ? (
                          <span className="text-xs text-slate-400">Protected</span>
                        ) : (
                          <Button variant="danger" className="px-3 py-1.5" onClick={() => setTarget(u)}>Delete</Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ConfirmDialog
        open={!!target}
        title="Delete user account?"
        message={target ? `Permanently delete ${target.name} (${target.email}) from Supabase Auth? They will no longer be able to sign in. This action cannot be undone.` : ''}
        confirmLabel={deleting ? 'Deleting…' : 'Delete account'}
        danger
        onConfirm={() => { void confirmDelete() }}
        onCancel={() => { if (!deleting) setTarget(null) }}
      />
      <p className="text-xs text-slate-500">Account deletion is handled by a server-side Supabase Edge Function. The browser never receives the service-role key.</p>
    </div>
  )
}

// -------------------- Dashboard --------------------
function DashboardTab({ onNavigate }: { onNavigate: (tab: AdminTab, filter?: UserFilter) => void }) {
  const users = getUsers()
  const jobs = getJobs()
  const payments = getPayments()
  const tickets = getTickets()
  const queue = getApplicationQueue()

  const now = useCurrentTime()
  const active = users.filter((u) => u.subscribedUntil && u.subscribedUntil > now)
  const free = users.filter((u) => !u.subscribedUntil || u.subscribedUntil <= now)
  const expiringSoon = active.filter((u) => u.subscribedUntil && u.subscribedUntil - now < 7 * 24 * 3600_000)
  const revenue = payments.filter((p) => p.status === 'success').reduce((s, p) => s + p.amount, 0)
  const todayStart = now ? new Date(now).setHours(0, 0, 0, 0) : 0
  const newToday = users.filter((u) => u.createdAt >= todayStart).length
  const openTickets = tickets.filter((t) => t.status !== 'resolved').length

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">📊 Admin Monitor</h2>
        <div className="text-xs text-slate-500 mt-0.5">Tap any card to open its full page.</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total users" value={users.length} color="brand" icon="👥" hint="Open users" onClick={() => onNavigate('users', 'all')} />
        <StatCard label="Active subscribers" value={active.length} color="green" icon="💎" hint="Open subscribers" onClick={() => onNavigate('users', 'active')} />
        <StatCard label="Free users" value={free.length} color="amber" icon="🆓" hint="Open free users" onClick={() => onNavigate('users', 'free')} />
        <StatCard label="Live jobs" value={jobs.length} color="purple" icon="💼" hint="Open vacancies" onClick={() => onNavigate('vacancies')} />
        <StatCard label="New today" value={newToday} color="brand" icon="✨" hint="Open users" onClick={() => onNavigate('users', 'all')} />
        <StatCard label="Open tickets" value={openTickets} color="red" icon="🎫" hint="Open tickets" onClick={() => onNavigate('tickets')} />
        <StatCard label="Applications" value={queue.length} color="purple" icon="✉️" hint="Open applications" onClick={() => onNavigate('applications')} />
        <StatCard label="Revenue" value={`₹${revenue.toLocaleString('en-IN')}`} color="green" icon="💰" hint="Open payments" onClick={() => onNavigate('payments')} />
      </div>

      <Card className="p-4">
        <div className="font-bold text-slate-900 mb-2">Subscriptions expiring in 7 days ({expiringSoon.length})</div>
        {expiringSoon.length === 0 ? (
          <div className="text-sm text-slate-500">No expiring subscriptions this week.</div>
        ) : (
          <ul className="text-sm text-slate-700 space-y-1">
            {expiringSoon.map((u) => (
              <li key={u.id} className="flex items-center justify-between">
                <span>{u.name} · {u.email}</span>
                <Badge color="amber">{new Date(u.subscribedUntil!).toLocaleDateString()}</Badge>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => onNavigate('users', 'active')}
          className="text-xs font-semibold text-brand-600 mt-2 hover:underline touch-manipulation"
        >
          View all subscribers →
        </button>
      </Card>

      <Card className="p-4">
        <div className="font-bold text-slate-900 mb-2">Recent payments</div>
        {payments.length === 0 ? (
          <div className="text-sm text-slate-500">No transactions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-left">
                <tr>
                  <th className="py-1 pr-2">Time</th>
                  <th className="py-1 pr-2">User</th>
                  <th className="py-1 pr-2">Plan</th>
                  <th className="py-1 pr-2">Amount</th>
                  <th className="py-1 pr-2">TXN</th>
                  <th className="py-1 pr-2">Expiry</th>
                  <th className="py-1 pr-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 10).map((p) => {
                  const u = users.find((x) => x.id === p.userId)
                  const plan = getPlans().find((pl) => pl.id === p.planId)
                  return (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="py-1 pr-2 text-xs text-slate-500">{new Date(p.createdAt).toLocaleString()}</td>
                      <td className="py-1 pr-2 font-medium text-slate-900">{u?.name ?? p.userId}</td>
                      <td className="py-1 pr-2 text-slate-700">{plan?.title ?? p.planId}</td>
                      <td className="py-1 pr-2 font-bold text-slate-900">₹{p.amount}</td>
                      <td className="py-1 pr-2 font-mono text-xs text-slate-500">{p.txRef ?? '—'}{p.utr ? ` · UTR ${p.utr}` : ''}</td>
                      <td className="py-1 pr-2 text-xs">{p.expiresAt ? new Date(p.expiresAt).toLocaleDateString() : '—'}</td>
                      <td className="py-1 pr-2"><Badge color={p.status === 'success' ? 'green' : p.status === 'pending' ? 'amber' : 'red'}>{p.status}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <button
          type="button"
          onClick={() => onNavigate('payments')}
          className="text-xs font-semibold text-brand-600 mt-2 hover:underline touch-manipulation"
        >
          Open payments page →
        </button>
      </Card>

      <Card className="p-4 bg-gradient-to-br from-indigo-50 to-brand-50 ring-1 ring-brand-200 text-sm text-slate-700">
        <div className="font-bold text-slate-900 mb-1">☁️ Supabase write mirror</div>
        <p>
          Most product data remains local-first. Selected Admin writes use the current Supabase Auth token and are checked again by RLS; ordinary user sessions cannot write these mirror tables. The registered-account list is read from the Auth-backed account table. Apply <code className="text-xs bg-white px-1 rounded">supabase/schema.sql</code> in the Supabase SQL Editor to configure the tables and policies.
        </p>
        <SupabaseSyncStatus />
      </Card>
    </div>
  )
}

function SupabaseSyncStatus() {
  const [status, setStatus] = useState(getSyncStatus)

  useEffect(() => {
    const refresh = () => setStatus(getSyncStatus())
    refresh()
    const intervalId = window.setInterval(refresh, 4000)
    return () => window.clearInterval(intervalId)
  }, [])

  const summary = status.state === 'off'
    ? 'off — Supabase is not configured'
    : status.state === 'idle'
      ? 'waiting for first write'
      : status.state === 'ok'
        ? `✅ mirroring — last table: ${status.lastTable ?? 'unknown'}`
        : `⚠️ failed${status.lastHttpStatus === null ? ' — network error' : ` — HTTP ${status.lastHttpStatus}`}`

  return (
    <div className="mt-3 rounded-xl bg-white/80 p-3 text-xs text-slate-700 ring-1 ring-brand-100" role="status" aria-live="polite">
      <div className="font-semibold text-slate-900">{summary}</div>
      {status.configured && <div className="mt-1 break-all text-slate-500">{status.url}</div>}
      {status.lastAt !== null && (
        <div className="mt-1 text-slate-500">
          Last attempt: {new Date(status.lastAt).toLocaleString()}
          {status.lastTable && status.state !== 'ok' ? ` · table: ${status.lastTable}` : ''}
        </div>
      )}
      {status.state === 'off' && (
        <div className="mt-1 text-slate-500">Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable mirroring.</div>
      )}
      {status.state === 'error' && status.lastHttpStatus === 404 && (
        <div className="mt-1 font-medium text-amber-800">Table not found — run supabase/schema.sql in the Supabase SQL Editor.</div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
  icon,
  hint,
  onClick,
}: {
  label: string
  value: number | string
  color: 'brand' | 'green' | 'amber' | 'purple' | 'red'
  icon: string
  hint?: string
  onClick?: () => void
}) {
  const bg = {
    brand: 'from-brand-50 to-brand-100 text-brand-800 ring-brand-200',
    green: 'from-emerald-50 to-emerald-100 text-emerald-800 ring-emerald-200',
    amber: 'from-amber-50 to-amber-100 text-amber-800 ring-amber-200',
    purple: 'from-purple-50 to-purple-100 text-purple-800 ring-purple-200',
    red: 'from-red-50 to-red-100 text-red-800 ring-red-200',
  }[color]
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`w-full text-left rounded-2xl p-3 bg-gradient-to-br ring-1 transition hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] touch-manipulation ${bg}`}
    >
      <div className="flex items-center gap-2">
        <div className="text-2xl">{icon}</div>
        <div className="min-w-0">
          <div className="text-xl font-extrabold truncate">{value}</div>
          <div className="text-[10px] uppercase tracking-wide font-semibold opacity-80">{label}</div>
        </div>
      </div>
      {hint && (
        <div className="mt-1.5 text-[10px] font-semibold opacity-70 flex items-center gap-1">
          {hint} <span aria-hidden>→</span>
        </div>
      )}
    </button>
  )
}

// -------------------- Profile (AI update composer) --------------------
function ProfileTab() {
  const [msg, setMsg] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [sent, setSent] = useState(false)

  function doReview() {
    if (!msg.trim()) return
    setSent(false)
    setReview(reviewPlatformMessage(msg))
  }

  function send() {
    // Send only the AI-polished + rechecked copy, never the raw draft
    const text = (review?.polished ?? reviewPlatformMessage(msg).polished).trim()
    if (!text) return
    broadcast({ kind: 'platform-update', message: text }, { type: 'update' })
    setMsg('')
    setReview(null)
    setSent(true)
    setTimeout(() => setSent(false), 6000)
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">Creator profile (frozen)</h2>
      <Card className="p-4 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white grid place-items-center text-xl font-extrabold">
          Mr.
        </div>
        <div>
          <div className="text-lg font-extrabold text-slate-900">Mr. {CREATOR.name}</div>
          <div className="text-sm text-slate-500">{CREATOR.role}</div>
          <div className="text-xs text-slate-500 mt-1">{CREATOR.title}</div>
        </div>
      </Card>
      <Card className="p-4 text-sm text-slate-700 space-y-2">
        <div className="flex items-center gap-2"><span className="font-semibold text-slate-900 w-32 shrink-0">Admin email:</span> <span className="font-mono text-brand-700">{CREATOR.adminEmail}</span></div>
        <div className="flex items-center gap-2"><span className="font-semibold text-slate-900 w-32 shrink-0">Admin mobile:</span> <span className="font-mono text-slate-900">{CREATOR.adminMobile}</span> <Badge color="green">Admin visible</Badge></div>
        <div className="text-xs text-slate-500 pt-1">Admin contact details are visible inside the admin panel only — never exposed on user pages. Every automated notification is signed "Mr. {CREATOR.name}, {CREATOR.role}, MedRep Connect Pro".</div>
      </Card>

      {/* AI composer: type → AI polish & recheck → admin reviews → send */}
      <Card className="p-4 space-y-3">
        <div className="font-bold text-slate-900">📣 Platform update to ALL users (AI-assisted)</div>
        <div className="text-xs text-slate-500">
          Type your message in simple words — the AI will polish grammar & tone, recheck it for admin-only details, show you a preview, and only send after you confirm.
        </div>
        <Textarea
          rows={3}
          placeholder="e.g. new mr jobs posted this week plz check priority section"
          value={msg}
          onChange={(e) => { setMsg(e.target.value); setReview(null) }}
        />
        {sent && (
          <div className="text-sm font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-xl px-3 py-2">
            ✅ AI-polished notification sent to all users (with sound).
          </div>
        )}

        {!review ? (
          <div className="flex justify-end">
            <Button onClick={doReview} disabled={!msg.trim()}>✨ AI polish &amp; recheck</Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-2xl ring-1 ring-brand-200 bg-brand-50/40 p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-800">AI recheck report</div>
            <ul className="space-y-1">
              {review.checks.map((c) => (
                <li key={c} className="text-xs text-emerald-700 font-semibold">{c}</li>
              ))}
              {review.warnings.map((w) => (
                <li key={w} className="text-xs text-amber-700 font-semibold">⚠ {w}</li>
              ))}
            </ul>
            <div>
              <div className="text-xs font-bold text-slate-900 mb-1">Final preview (exactly what users receive):</div>
              <div className="bg-white rounded-xl ring-1 ring-slate-200 p-3 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                {review.polished}
                {'\n\n'}— Mr. {CREATOR.name}, {CREATOR.role}, MedRep Connect Pro
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="secondary" onClick={() => setReview(null)}>✏️ Edit draft</Button>
              <Button variant="accent" onClick={send}>📣 Approve &amp; send to all users</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
