import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge, Button, Card, Input, Label, Modal, Textarea } from '../components/ui'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { VacancyForm } from '../components/VacancyForm'
import { VacancyTeamAdmin } from '../components/VacancyTeamAdmin'
import { Wordmark } from '../components/Logo'
import { CREATOR } from '../data/creator'
import { APP_VERSION_LABEL } from '../data/version'
import { currentUser, deleteUserAccount, getUsers, grantManualAccess, refreshAdminUsers, type User } from '../data/auth'
import {
  deleteJob,
  getJobs,
  getLegacyJobs,
  importLegacyJobs,
  loadAdminJobs,
  sortedJobs,
  togglePin,
  type Job,
} from '../data/jobs'
import {
  deleteReasonProblem,
  paymentStatusLabel,
  paymentStatusTone,
  paymentTotals,
  paymentTypeLabel,
  type PaymentLike,
} from '../data/vacancyRules'
import { getAllPlansIncludingRetired, refreshPlans, savePlans, type Plan } from '../data/plans'
import {
  getPayments,
  refreshPayments,
  reviewManualUpiPayment,
  type PaymentRecord,
} from '../data/payments'
import {
  listAllSupportRequests,
  requestEmail,
  requestName,
  SUPPORT_REQUESTS_SETUP_STEPS,
  supportRequestsSetupMissing,
  ticketNumber,
  updateSupportRequest,
  type AiVerdict,
  type SupportRequest,
  type SupportStatus,
} from '../data/supportRequests'
import { reasonLabel } from '../data/refundCheck'
import { getCachedApplications, loadAllApplications, type ApplicationRecord } from '../data/apply'
import { announcementSignOff, broadcast, sendAnnouncement } from '../data/notifications'
import { reviewPlatformMessage, type Review } from '../data/aiPolish'
import { getSyncStatus } from '../data/supabase'
import { publishToEveryone, pushReach, type PushReach } from '../data/push'
import { announcementProblem, ANNOUNCEMENT_WARN_DEVICES } from '../data/pushRules'
import {
  adminSecurityAudit,
  adminSecurityState,
  setAdminMfaRequired,
  type AdminSecurityState,
  type SecurityChange,
} from '../data/mfa'

type AdminTab = 'dashboard' | 'vacancies' | 'announce' | 'team' | 'plans' | 'payments' | 'applications' | 'tickets' | 'users' | 'security' | 'profile'

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'vacancies', label: 'Vacancies', icon: '💼' },
  { id: 'announce', label: 'Announcements', icon: '📣' },
  { id: 'plans', label: 'Plans', icon: '💎' },
  { id: 'payments', label: 'Payments', icon: '💳' },
  { id: 'applications', label: 'Applications', icon: '✉️' },
  { id: 'tickets', label: 'Requests', icon: '🎫' },
  { id: 'team', label: 'Vacancy team', icon: '👥' },
  { id: 'users', label: 'Users', icon: '👥' },
  { id: 'security', label: 'Security', icon: '🔐' },
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
  const [requests, setRequests] = useState<SupportRequest[]>([])
  const [requestsError, setRequestsError] = useState<string | null>(null)

  // Refund and support requests live on the server; reload after each admin change.
  useEffect(() => {
    let active = true
    void listAllSupportRequests()
      .then((list) => { if (active) { setRequests(list); setRequestsError(null) } })
      .catch((cause: unknown) => {
        if (active) setRequestsError(cause instanceof Error ? cause.message : 'Requests could not be loaded.')
      })
    return () => { active = false }
  }, [version])

  useEffect(() => {
    let active = true
    void refreshAdminUsers()
      .then(() => { if (active) setVersion((v) => v + 1) })
      .catch(() => undefined)
    void refreshPayments()
      .then(() => { if (active) setVersion((v) => v + 1) })
      .catch(() => undefined)
    void loadAdminJobs()
      .then(() => { if (active) setVersion((v) => v + 1) })
      .catch(() => undefined)
    void loadAllApplications()
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

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <AdminSearchCard requests={requests} onNavigate={navigate} />
        {tab === 'dashboard' && <DashboardTab requests={requests} onNavigate={navigate} />}
        {tab === 'vacancies' && <VacanciesTab onMutate={bump} />}
        {tab === 'announce' && <AnnouncementsTab />}
        {tab === 'team' && <VacancyTeamAdmin />}
        {tab === 'plans' && <PlansTab onMutate={bump} />}
        {tab === 'payments' && <PaymentsTab onMutate={bump} />}
        {tab === 'applications' && <ApplicationsTab />}
        {tab === 'tickets' && <TicketsTab requests={requests} error={requestsError} onMutate={bump} />}
        {tab === 'users' && <UsersTab filter={usersFilter} onFilter={setUsersFilter} />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'profile' && <ProfileTab />}
      </div>
    </div>
  )
}

// -------------------- Applications --------------------
function ApplicationsTab() {
  const [queue, setQueue] = useState<ApplicationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ApplicationRecord | null>(null)

  useEffect(() => {
    let active = true
    void loadAllApplications()
      .then((records) => { if (active) { setQueue(records); setError(null) } })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Applications could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-900">✉️ Applications (Email · WhatsApp fallback)</h2>
        <Badge color="brand">{queue.length}</Badge>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>}
      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">Loading applications…</Card>
      ) : queue.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No applications have been submitted yet.</Card>
      ) : (
        <div className="grid gap-2">
          {queue.map((m) => (
            <Card
              key={m.id}
              onClick={() => setView(m)}
              className="p-3 active:bg-slate-50 transition cursor-pointer"
            >
              {/* One line per fact, wrapping instead of clipping, so a phone
                  shows the same information a desktop does. */}
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg grid place-items-center text-base shrink-0 ${m.channel === 'email' ? 'bg-brand-100 text-brand-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {m.channel === 'email' ? '✉️' : '💬'}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 break-words">{m.applicantName}</span>
                    <Badge color={m.channel === 'email' ? 'brand' : 'green'}>{m.channel === 'email' ? 'Email' : 'WhatsApp'}</Badge>
                  </div>
                  <div className="text-sm text-slate-800 break-words">{m.jobTitle}</div>
                  <div className="text-xs text-slate-600 break-words">
                    {m.company || 'Company confidential'} · to {m.manager}
                  </div>
                  <div className="text-xs text-slate-500 break-all">{m.to}</div>
                  <div className="text-[11px] text-slate-400 break-words">
                    {new Date(m.sentAt).toLocaleString('en-IN')}
                    {m.resumeFileName ? ` · resume: ${m.resumeFileName}` : ''}
                  </div>
                </div>
                <span aria-hidden className="text-slate-300 text-xl leading-none shrink-0">›</span>
              </div>
              <div className="mt-2.5">
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => setView(m)}
                >
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
            <div className="text-xs text-slate-500 space-y-1">
              <div className="break-words"><span className="font-semibold">Channel:</span> {view.channel === 'email' ? 'Email' : 'WhatsApp'}</div>
              <div className="break-all"><span className="font-semibold">To:</span> {view.to}</div>
              <div className="break-all"><span className="font-semibold">From (candidate):</span> {view.applicantEmail}</div>
              {view.subject && <div className="break-words"><span className="font-semibold">Subject:</span> {view.subject}</div>}
              <div className="break-words"><span className="font-semibold">When:</span> {new Date(view.sentAt).toLocaleString('en-IN')}</div>
              {view.resumeFileName && (
                <div className="break-words"><span className="font-semibold">Resume on file:</span> {view.resumeFileName}</div>
              )}
            </div>
            <pre className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3 text-xs overflow-auto whitespace-pre-wrap break-words max-h-96 text-slate-800">{view.body}</pre>
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
  const [deleteReason, setDeleteReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const legacyCount = getLegacyJobs().length
  const reasonProblem = deleteReason.trim() ? deleteReasonProblem(deleteReason) : null

  function confirmDelete() {
    if (!deleteTarget || deleteReasonProblem(deleteReason)) return
    const target = deleteTarget
    const reason = deleteReason
    setDeleteTarget(null)
    setDeleteReason('')
    void change(() => deleteJob(target.id, reason))
  }

  async function change(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try { await action(); onMutate() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Vacancy change failed.') }
    finally { setBusy(false) }
  }

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
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>}
      {legacyCount > 0 && (
        <Card className="p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-900">{legacyCount} older vacancies remain on this admin device. Review them first; sample vacancies may be included. Import only verified posts to the secure Supabase catalog.</p>
          <Button variant="secondary" disabled={busy} onClick={() => { void change(importLegacyJobs) }}>Import older vacancies</Button>
        </Card>
      )}
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
                  {j.company} · {j.location} · {j.salary || 'Salary not mentioned'}{j.postedBy ? ` · posted by ${j.postedBy}` : ''}
                </div>
              </div>
            </div>
            {/* Action row — always visible on mobile (no side overflow) */}
            <div className="flex items-center gap-2 mt-3">
              <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => { void change(() => togglePin(j.id, !j.pinned)) }}>
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

      <Modal open={!!deleteTarget} onClose={() => { setDeleteTarget(null); setDeleteReason('') }} title="Delete vacancy">
        {deleteTarget && (
          <div className="space-y-3">
            <div className="text-sm text-slate-900">
              <span className="font-semibold">{deleteTarget.title}</span> · {deleteTarget.company} · {deleteTarget.location}
            </div>
            <div>
              <Label htmlFor="vacancy-delete-reason">Reason for deleting</Label>
              <Textarea
                id="vacancy-delete-reason"
                rows={3}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="e.g. Position filled, duplicate entry, closed by employer"
              />
              <div className="mt-1 text-xs text-slate-600">Required · 5 to 300 characters · kept in Vacancy team → Deleted</div>
            </div>
            {reasonProblem && <p role="alert" className="text-sm font-semibold text-red-800">{reasonProblem}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => { setDeleteTarget(null); setDeleteReason('') }}>Cancel</Button>
              <Button variant="danger" className="flex-1" disabled={!!deleteReasonProblem(deleteReason) || busy} onClick={confirmDelete}>Delete vacancy</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// -------------------- Plans --------------------
function PlansTab({ onMutate }: { onMutate: () => void }) {
  const [plans, setPlans] = useState<Plan[]>(() => getAllPlansIncludingRetired())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    void refreshPlans()
      .then((loaded) => { if (active) { setPlans(loaded); setError(null) } })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'The plan catalog could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  function update(index: number, patch: Partial<Plan>) {
    setPlans((current) => current.map((plan, position) => (position === index ? { ...plan, ...patch } : plan)))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    const result = await savePlans(plans)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPlans(result.plans)
    setSaved(true)
    onMutate()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-900">Plans &amp; Pricing</h2>
        <Button onClick={() => { void save() }} disabled={saving || loading}>
          {saving ? 'Saving to server…' : 'Save changes'}
        </Button>
      </div>
      <p className="rounded-xl bg-indigo-50 p-3 text-sm font-medium text-indigo-950 ring-1 ring-indigo-200">
        Prices and durations are stored on the server (<code className="font-mono text-xs">public.billing_plans</code>) and
        Razorpay orders are created from those same values — the browser never supplies an amount. Saving requires an
        MFA-verified administrator session. Existing subscriptions and already-created orders keep the amount and duration
        they were sold with.
      </p>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>}
      {saved && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">Plan catalog saved to the server.</p>}
      {loading ? (
        <Card className="p-5 text-sm text-slate-700">Loading the server catalog…</Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {plans.map((p, i) => (
            <Card key={p.id} className={`p-3 space-y-2 ${p.active ? '' : 'opacity-70'}`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label>Title</Label>
                  <Input value={p.title} onChange={(e) => update(i, { title: e.target.value })} />
                </div>
                <div>
                  <Label>Checkout amount (₹)</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={p.price}
                    aria-label={`Checkout price for ${p.title}`}
                    onChange={(e) => update(i, { price: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                  />
                </div>
                <div>
                  <Label>Plan validity (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3650}
                    value={p.days}
                    aria-label={`Plan validity for ${p.title}`}
                    onChange={(e) => update(i, { days: Math.min(3650, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                  />
                </div>
                <div className="flex items-end gap-3 pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!p.popular} onChange={(e) => update(i, { popular: e.target.checked })} />
                    Popular
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={p.active !== false} onChange={(e) => update(i, { active: e.target.checked })} />
                    On sale
                  </label>
                </div>
                <div className="col-span-2">
                  <Label>Tagline</Label>
                  <Input value={p.tagline} onChange={(e) => update(i, { tagline: e.target.value })} />
                </div>
              </div>
              <div className="text-[11px] text-slate-500">
                {p.price >= 1 ? `₹${p.price} for ${p.days} day${p.days === 1 ? '' : 's'}` : 'Set a price of ₹1 or more.'}
                {p.updatedAt ? ` · last saved ${new Date(p.updatedAt).toLocaleString('en-IN')}` : ''}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// -------------------- Payments --------------------
/** Date and time as "13 Oct 2026, 10:42", or a dash when there is none. */
function formatDateTime(value?: number): string {
  return value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

type PaymentFilter = 'all' | 'paid' | 'pending' | 'attention'

function PaymentsTab({ onMutate }: { onMutate: () => void }) {
  const [payments, setPayments] = useState<PaymentRecord[]>(() => getPayments())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [decision, setDecision] = useState<{ payment: PaymentRecord; approve: boolean } | null>(null)
  const [details, setDetails] = useState<PaymentRecord | null>(null)
  const [filter, setFilter] = useState<PaymentFilter>('all')

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

  async function reload() {
    setLoading(true)
    setError(null)
    try { setPayments(await refreshPayments()) }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Payment records could not be loaded.') }
    finally { setLoading(false) }
  }

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

  const totals = paymentTotals(payments)
  const attention = (p: PaymentRecord) => Boolean(p.manualReview) || p.status === 'failed' || p.status === 'rejected'
  const shown = payments.filter((p) => {
    if (filter === 'paid') return p.status === 'success' && !p.manualReview
    if (filter === 'pending') return p.status === 'pending' && !p.manualReview
    if (filter === 'attention') return attention(p)
    return true
  })
  const filters: { id: PaymentFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: payments.length },
    { id: 'paid', label: 'Paid', count: totals.paidCount },
    { id: 'pending', label: 'Pending', count: totals.pendingCount },
    { id: 'attention', label: 'Needs action', count: payments.filter(attention).length },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">Payments ({payments.length})</h2>
        <Button variant="secondary" onClick={() => { void reload() }} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button>
      </div>

      {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-900 ring-1 ring-red-300">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryTile label="Paid" value={String(totals.paidCount)} detail={`₹${totals.paidAmount.toLocaleString('en-IN')} total`} tone="text-emerald-700" />
        <SummaryTile label="Pending" value={String(totals.pendingCount)} detail="waiting for Razorpay" tone="text-amber-700" />
        <SummaryTile label="Waiting bank check" value={String(totals.waitingBankCheck)} detail="UPI transfers" tone="text-amber-700" />
        <SummaryTile label="Failed or rejected" value={String(totals.failedCount)} detail="no plan activated" tone="text-red-700" />
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${filter === item.id ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
          >
            {item.label} <span className="opacity-80">({item.count})</span>
          </button>
        ))}
      </div>

      {loading && payments.length === 0 ? (
        <Card className="p-5 text-sm text-slate-700">Loading payments…</Card>
      ) : shown.length === 0 ? (
        <Card className="p-5 text-sm text-slate-700">No payments in this list.</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1040px]">
              <thead className="bg-slate-100 text-left text-slate-800">
                <tr>
                  <th className="px-3 py-2 font-bold">Date</th>
                  <th className="px-3 py-2 font-bold">Customer</th>
                  <th className="px-3 py-2 font-bold">Plan</th>
                  <th className="px-3 py-2 font-bold text-right">Amount</th>
                  <th className="px-3 py-2 font-bold">Payment type</th>
                  <th className="px-3 py-2 font-bold">Status</th>
                  <th className="px-3 py-2 font-bold">Payment ID</th>
                  <th className="px-3 py-2 font-bold">UTR</th>
                  <th className="px-3 py-2 font-bold">Valid until</th>
                  <th className="px-3 py-2 font-bold">Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((payment) => {
                  const account = getUsers().find((candidate) => candidate.id === payment.userId)
                  const busy = reviewing === payment.id
                  return (
                    <tr key={payment.id} className="border-t border-slate-200 align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-800">{formatDateTime(payment.createdAt)}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{account?.name ?? '—'}</div>
                        <div className="text-xs text-slate-600">{account?.email ?? payment.userId}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-slate-900">{payment.planTitle ?? payment.planId}</div>
                        <div className="text-xs text-slate-600">{payment.planDays ? `${payment.planDays} days` : '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900 whitespace-nowrap">₹{payment.amount.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 text-slate-800 whitespace-nowrap">{paymentTypeLabel(payment.paymentMethod)}</td>
                      <td className="px-3 py-2"><Badge color={paymentStatusTone(payment)}>{paymentStatusLabel(payment)}</Badge></td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-800 break-all">{payment.gatewayPaymentId ?? payment.txRef ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-800">{payment.utr || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-800">{payment.expiresAt ? formatDateTime(payment.expiresAt) : 'Not active'}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2 whitespace-nowrap">
                          <Button variant="secondary" onClick={() => setDetails(payment)}>Details</Button>
                          {payment.manualReview && (
                            <>
                              <Button variant="secondary" disabled={busy} onClick={() => setDecision({ payment, approve: false })}>Reject</Button>
                              <Button disabled={busy} onClick={() => setDecision({ payment, approve: true })}>Verify</Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={!!details} onClose={() => setDetails(null)} title="Payment details">
        {details && (
          <div className="space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-semibold text-slate-600">Customer</dt>
              <dd className="text-slate-900">{getUsers().find((u) => u.id === details.userId)?.name ?? '—'}</dd>
              <dt className="font-semibold text-slate-600">Plan</dt>
              <dd className="text-slate-900">{details.planTitle ?? details.planId} · {details.planDays ? `${details.planDays} days` : '—'}</dd>
              <dt className="font-semibold text-slate-600">Amount</dt>
              <dd className="text-slate-900">₹{details.amount.toLocaleString('en-IN')}</dd>
              <dt className="font-semibold text-slate-600">Payment type</dt>
              <dd className="text-slate-900">{paymentTypeLabel(details.paymentMethod)}</dd>
              <dt className="font-semibold text-slate-600">Status</dt>
              <dd><Badge color={paymentStatusTone(details)}>{paymentStatusLabel(details)}</Badge></dd>
              <dt className="font-semibold text-slate-600">Order ID</dt>
              <dd className="font-mono text-xs break-all text-slate-900">{details.orderId ?? '—'}</dd>
              <dt className="font-semibold text-slate-600">Payment ID</dt>
              <dd className="font-mono text-xs break-all text-slate-900">{details.gatewayPaymentId ?? details.txRef ?? '—'}</dd>
              <dt className="font-semibold text-slate-600">UTR</dt>
              <dd className="font-mono text-xs break-all text-slate-900">{details.utr || '—'}</dd>
              <dt className="font-semibold text-slate-600">Created</dt>
              <dd className="text-slate-900">{formatDateTime(details.createdAt)}</dd>
              <dt className="font-semibold text-slate-600">Valid until</dt>
              <dd className="text-slate-900">{details.expiresAt ? formatDateTime(details.expiresAt) : 'Not active'}</dd>
            </dl>
            <NextStep payment={details} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!decision}
        title={decision?.approve ? 'Verify UPI transfer?' : 'Reject UPI transfer?'}
        message={decision?.approve
          ? `Check UTR ${decision.payment.utr ?? '—'}, amount ₹${decision.payment.amount} and date in the bank statement first. Verifying activates ${decision.payment.planDays} days.`
          : 'Reject this UPI transfer? No plan will be activated.'}
        confirmLabel={decision?.approve ? 'Verified — activate' : 'Reject'}
        danger={decision ? !decision.approve : false}
        onConfirm={() => { if (decision) void review(decision.payment, decision.approve) }}
        onCancel={() => { if (!reviewing) setDecision(null) }}
      />
    </div>
  )
}

function SummaryTile({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`text-2xl font-extrabold ${tone}`}>{value}</div>
      <div className="text-xs text-slate-600">{detail}</div>
    </Card>
  )
}

/** One short line on what the administrator should do next, by payment type and status. */
function NextStep({ payment }: { payment: PaymentLike & { status: PaymentRecord['status'] } }) {
  let text: string
  if (payment.manualReview) text = 'Next: match the UTR, amount and date in the bank statement, then verify or reject.'
  else if (payment.status === 'pending') text = 'Next: nothing to do. The plan starts when Razorpay confirms the payment.'
  else if (payment.status === 'success') text = 'Next: nothing to do. The plan is active. Refunds are made from the Razorpay dashboard.'
  else text = 'Next: nothing to do. No plan was activated.'
  return <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-xs font-semibold text-slate-800">{text}</div>
}

// -------------------- Requests (refunds & support) --------------------
const STATUS_COLOR: Record<SupportStatus, 'red' | 'amber' | 'green'> = {
  open: 'red',
  in_progress: 'amber',
  resolved: 'green',
}
const VERDICT_LABEL: Record<AiVerdict, string> = {
  eligible: 'AI: eligible',
  needs_review: 'AI: needs review',
  not_eligible: 'AI: not eligible',
}
const VERDICT_COLOR: Record<AiVerdict, 'green' | 'amber' | 'slate'> = {
  eligible: 'green',
  needs_review: 'amber',
  not_eligible: 'slate',
}

function TicketsTab({ requests, error, onMutate }: { requests: SupportRequest[]; error: string | null; onMutate: () => void }) {
  const [reply, setReply] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const openCount = requests.filter((r) => r.status !== 'resolved').length

  async function change(r: SupportRequest, status: SupportStatus, text?: string) {
    setBusyId(r.id)
    setActionError(null)
    const result = await updateSupportRequest(r.id, status, text)
    setBusyId(null)
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    if (text?.trim()) setReply((all) => ({ ...all, [r.id]: '' }))
    onMutate()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-900">Refund &amp; support requests ({openCount} open · {requests.length} total)</h2>
      </div>
      {error && (supportRequestsSetupMissing(error) ? (
        // The table is created by supabase/support_requests.sql. A missing
        // migration is a setup step, not a failure — so say what to run.
        <Card className="p-3 bg-amber-50 ring-1 ring-amber-200 space-y-1.5">
          <div className="text-sm font-bold text-amber-900">Requests are not switched on in this project yet</div>
          <div className="text-xs text-amber-900">
            Until the Requests migration has been run, users cannot raise refund or support requests and this page
            stays empty. It takes one paste:
          </div>
          <div className="text-xs text-amber-900 font-medium">{SUPPORT_REQUESTS_SETUP_STEPS}</div>
        </Card>
      ) : (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>
      ))}
      {actionError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">{actionError}</p>}
      {requests.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No refund or support requests yet. Requests raised from AI Help appear here.</Card>
      ) : (
        requests.map((r) => {
          const payment = r.paymentId ? getPayments().find((p) => p.id === r.paymentId) : undefined
          const busy = busyId === r.id
          return (
            <Card key={r.id} className="p-3 space-y-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-slate-500">#{ticketNumber(r.id)}</span>
                  <div className="font-semibold text-slate-900 truncate">{r.subject}</div>
                  {r.kind === 'refund' && <Badge color="red">Refund</Badge>}
                  {r.aiVerdict && <Badge color={VERDICT_COLOR[r.aiVerdict]}>{VERDICT_LABEL[r.aiVerdict]}</Badge>}
                  <Badge color={STATUS_COLOR[r.status]}>{r.status.replace('_', ' ')}</Badge>
                </div>
                <div className="text-xs text-slate-500">
                  {requestName(r)} · {requestEmail(r)} · {String(r.details.phone ?? '—')} · {new Date(r.createdAt).toLocaleString('en-IN')}
                </div>
              </div>
              {r.reasonCode && <div className="text-xs text-slate-700">Reason: {reasonLabel(r.reasonCode)}</div>}
              {payment ? (
                <div className="text-xs text-slate-700 bg-slate-50 rounded-lg p-2 ring-1 ring-slate-200">
                  Payment: ₹{payment.amount} · {payment.planTitle ?? payment.planId} · TXN {payment.txRef ?? '—'} · UTR {payment.utr || '—'} · {payment.status}
                </div>
              ) : r.paymentId ? (
                <div className="text-xs text-slate-500">Payment ID: {r.paymentId}</div>
              ) : null}
              <div className="text-sm text-slate-700 bg-slate-50 rounded-lg p-2 ring-1 ring-slate-200 whitespace-pre-wrap">{r.message}</div>
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold">Account details</summary>
                <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">
                  <dt>City / state</dt><dd>{[r.details.city, r.details.state].filter(Boolean).join(', ') || '—'}</dd>
                  <dt>Subscribed</dt><dd>{r.details.subscribed ? `yes, until ${r.details.subscribedUntil ?? '—'}` : 'no'}</dd>
                  {typeof r.details.chatExcerpt === 'string' && (
                    <>
                      <dt>Chat</dt>
                      <dd className="whitespace-pre-wrap">{r.details.chatExcerpt}</dd>
                    </>
                  )}
                </dl>
              </details>
              {r.adminReply && (
                <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg p-2 ring-1 ring-emerald-200">
                  <span className="font-semibold">Reply:</span> {r.adminReply}
                </div>
              )}
              {/* Action row — always visible on mobile */}
              <div className="flex items-center gap-2">
                <Button variant="secondary" className="flex-1" disabled={busy || r.status === 'in_progress'} onClick={() => void change(r, 'in_progress')}>▶ Start</Button>
                <Button variant="secondary" className="flex-1" disabled={busy || r.status === 'resolved'} onClick={() => void change(r, 'resolved')}>✓ Resolve</Button>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Input placeholder="Type a reply…" value={reply[r.id] ?? ''} onChange={(e) => setReply((all) => ({ ...all, [r.id]: e.target.value }))} />
                <Button variant="secondary" className="shrink-0" disabled={busy || !reply[r.id]?.trim()} onClick={() => void change(r, r.status === 'open' ? 'in_progress' : r.status, reply[r.id])}>Reply</Button>
                <Button className="shrink-0" disabled={busy || !reply[r.id]?.trim()} onClick={() => void change(r, 'resolved', reply[r.id])}>Reply &amp; resolve</Button>
              </div>
            </Card>
          )
        })
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
  const [query, setQuery] = useState('')
  const [grantTarget, setGrantTarget] = useState<User | null>(null)
  const [grantDays, setGrantDays] = useState(15)
  const [granting, setGranting] = useState(false)
  const [grantError, setGrantError] = useState<string | null>(null)
  const [grantNotice, setGrantNotice] = useState<string | null>(null)
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
  const searchDigits = query.replace(/\D/g, '')
  const users = all.filter((u) => {
    const active = u.subscribedUntil && u.subscribedUntil > now
    if (filter === 'active') return active
    if (filter === 'free') return !active
    return true
  }).filter((u) => {
    if (!query.trim()) return true
    const haystack = `${u.name} ${u.email}`.toLowerCase()
    if (haystack.includes(query.trim().toLowerCase())) return true
    return Boolean(searchDigits) && (u.phone || '').includes(searchDigits)
  })
  const activeCount = all.filter((u) => u.subscribedUntil && u.subscribedUntil > now).length

  async function confirmGrant() {
    if (!grantTarget || granting) return
    setGranting(true)
    setGrantError(null)
    const result = await grantManualAccess(grantTarget.id, grantDays)
    setGranting(false)
    if (!result.ok) {
      setGrantError(result.error)
      return
    }
    setGrantNotice(
      `Access granted to ${grantTarget.name} for ${grantDays} days`
      + (result.expiresAt ? ` · active until ${new Date(result.expiresAt).toLocaleString('en-IN')}` : ''),
    )
    setGrantTarget(null)
    void refreshList()
  }

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
      {grantNotice && (
        <div role="status" className="rounded-lg bg-emerald-50 text-emerald-900 text-sm font-semibold px-3 py-2 ring-1 ring-emerald-200">
          {grantNotice}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search users by name, email or phone number…"
          aria-label="Search users by name, email or phone number"
        />
      </div>
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
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="secondary"
                              className="px-3 py-1.5 text-sm"
                              title="Manually grant special user access"
                              onClick={() => { setGrantDays(15); setGrantError(null); setGrantTarget(u) }}
                            >
                              🎁 Grant access
                            </Button>
                            <Button variant="danger" className="px-3 py-1.5" onClick={() => setTarget(u)}>Delete</Button>
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
        open={!!target}
        title="Delete user account?"
        message={target ? `Permanently delete ${target.name} (${target.email}) from Supabase Auth? They will no longer be able to sign in. This action cannot be undone.` : ''}
        confirmLabel={deleting ? 'Deleting…' : 'Delete account'}
        danger
        onConfirm={() => { void confirmDelete() }}
        onCancel={() => { if (!deleting) setTarget(null) }}
      />
      <Modal open={!!grantTarget} onClose={() => { if (!granting) setGrantTarget(null) }} title="Grant special user access">
        {grantTarget && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Manually grant <span className="font-bold text-slate-900">{grantTarget.name}</span> ({grantTarget.email}) paid access without a payment.
              The grant is recorded as a <span className="font-mono text-xs">manual_grant</span> audit row and extends any existing expiry.
            </p>
            <div>
              <Label htmlFor="grant-days">Access days</Label>
              <Input
                id="grant-days"
                type="number"
                min={1}
                max={3650}
                value={grantDays}
                onChange={(event) => setGrantDays(Math.max(1, Math.min(3650, Number(event.target.value) || 1)))}
              />
            </div>
            {grantError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-900">{grantError}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setGrantTarget(null)} disabled={granting}>Cancel</Button>
              <Button className="flex-1" onClick={() => { void confirmGrant() }} disabled={granting}>
                {granting ? 'Granting…' : `Grant ${grantDays} days`}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <p className="text-xs text-slate-500">Account deletion is handled by a server-side Supabase Edge Function. The browser never receives the service-role key.</p>
    </div>
  )
}

// -------------------- Global admin search --------------------
/**
 * One search box covering the datasets the admin needs: users (by phone
 * number, name or email), recent transactions (payments), tickets,
 * applications and payment records.
 */
function AdminSearchCard({ requests, onNavigate }: { requests: SupportRequest[]; onNavigate: (tab: AdminTab, filter?: UserFilter) => void }) {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const digits = trimmed.replace(/\D/g, '')
  const lower = trimmed.toLowerCase()
  const active = trimmed.length >= 2

  const users = active ? getUsers().filter((u) =>
    `${u.name} ${u.email}`.toLowerCase().includes(lower)
    || (digits.length >= 3 && (u.phone || '').includes(digits)),
  ).slice(0, 5) : []

  const payments = active ? getPayments().filter((p) => {
    const account = getUsers().find((candidate) => candidate.id === p.userId)
    return [p.gatewayPaymentId, p.txRef, p.utr, p.planTitle, p.planId, account?.name, account?.email, account?.phone]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(lower) || (digits.length >= 3 && String(value).includes(digits)))
  }).slice(0, 5) : []

  const tickets = active ? requests.filter((t) =>
    [t.subject, requestName(t), requestEmail(t), t.message, t.reasonCode ? reasonLabel(t.reasonCode) : '']
      .some((value) => String(value).toLowerCase().includes(lower)),
  ).slice(0, 5) : []

  const applications = active ? getCachedApplications().filter((a) =>
    [a.applicantName, a.applicantEmail, a.jobTitle, a.company, a.to].filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(lower) || (digits.length >= 3 && String(value).includes(digits))),
  ).slice(0, 5) : []

  const total = users.length + payments.length + tickets.length + applications.length

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xl">🔎</span>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search phone number, users, requests, applications, payments…"
          aria-label="Admin search"
        />
      </div>
      {active && total === 0 && (
        <div className="text-sm text-slate-500">No matches for “{trimmed}”.</div>
      )}
      {active && total > 0 && (
        <div className="space-y-3">
          {users.length > 0 && (
            <SearchGroup title="Users" count={users.length} onOpen={() => onNavigate('users', 'all')}>
              {users.map((u) => (
                <div key={u.id} className="text-sm text-slate-800">
                  <span className="font-semibold">{u.name}</span> · {u.email}{u.phone ? ` · 📞 ${u.phone}` : ''}
                </div>
              ))}
            </SearchGroup>
          )}
          {payments.length > 0 && (
            <SearchGroup title="Recent transactions / payments" count={payments.length} onOpen={() => onNavigate('payments')}>
              {payments.map((p) => {
                const account = getUsers().find((candidate) => candidate.id === p.userId)
                return (
                  <div key={p.id} className="text-sm text-slate-800">
                    <span className="font-semibold">₹{p.amount}</span> · {p.planTitle ?? p.planId} · {account?.name ?? p.userId} · {p.gatewayPaymentId ?? p.txRef ?? '—'} · {p.status}
                  </div>
                )
              })}
            </SearchGroup>
          )}
          {tickets.length > 0 && (
            <SearchGroup title="Requests" count={tickets.length} onOpen={() => onNavigate('tickets')}>
              {tickets.map((t) => (
                <div key={t.id} className="text-sm text-slate-800">
                  <span className="font-semibold">{t.subject}</span> · {requestName(t)} · {t.status.replace('_', ' ')}
                </div>
              ))}
            </SearchGroup>
          )}
          {applications.length > 0 && (
            <SearchGroup title="Applications" count={applications.length} onOpen={() => onNavigate('applications')}>
              {applications.map((a) => (
                <div key={a.id} className="text-sm text-slate-800">
                  <span className="font-semibold">{a.applicantName}</span> → {a.jobTitle} ({a.company}) · {a.channel}
                </div>
              ))}
            </SearchGroup>
          )}
        </div>
      )}
    </Card>
  )
}

function SearchGroup({ title, count, onOpen, children }: { title: string; count: number; onOpen: () => void; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{title} ({count})</div>
        <button type="button" onClick={onOpen} className="text-xs font-semibold text-brand-600 hover:underline">
          Open {title.toLowerCase()} page →
        </button>
      </div>
      <div className="mt-1 space-y-1 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-2.5">{children}</div>
    </div>
  )
}

// -------------------- Dashboard --------------------
function DashboardTab({ requests, onNavigate }: { requests: SupportRequest[]; onNavigate: (tab: AdminTab, filter?: UserFilter) => void }) {
  const users = getUsers()
  const jobs = getJobs()
  const payments = getPayments()
  const tickets = requests
  const queue = getCachedApplications()

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
        <StatCard label="Open requests" value={openTickets} color="red" icon="🎫" hint="Open requests" onClick={() => onNavigate('tickets')} />
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
                  // The payment row carries its own plan title; the catalog is
                  // only a fallback for very old records.
                  const plan = getAllPlansIncludingRetired().find((pl) => pl.id === p.planId)
                  return (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="py-1 pr-2 text-xs text-slate-500">{new Date(p.createdAt).toLocaleString()}</td>
                      <td className="py-1 pr-2 font-medium text-slate-900">{u?.name ?? p.userId}</td>
                      <td className="py-1 pr-2 text-slate-700">{p.planTitle ?? plan?.title ?? p.planId}</td>
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

// -------------------- Announcements (to every user) --------------------
function AnnouncementsTab() {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [reach, setReach] = useState<PushReach | null>(null)
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string; detail?: string } | null>(null)

  const loadReach = useCallback(async () => { setReach(await pushReach()) }, [])
  useEffect(() => {
    const first = window.setTimeout(() => { void loadReach() }, 0)
    const interval = window.setInterval(() => { void loadReach() }, 30_000)
    return () => { window.clearTimeout(first); window.clearInterval(interval) }
  }, [loadReach])

  const problem = announcementProblem(title, message)

  async function publish() {
    if (problem) { setResult({ kind: 'error', text: problem }); return }
    setBusy(true)
    setResult(null)
    const outcome = await sendAnnouncement(title, message)
    setBusy(false)
    if (!outcome.ok) { setResult({ kind: 'error', text: outcome.error }); return }
    const delivery = outcome.delivery
    setResult({
      kind: 'ok',
      text: `Announcement sent to every user${delivery ? ` — ${delivery.sent} of ${delivery.devices} device${delivery.devices === 1 ? '' : 's'} notified` : ''}.`,
      detail: outcome.warning ?? (delivery && delivery.failed > 0
        ? `${delivery.failed} device${delivery.failed === 1 ? '' : 's'} could not be reached and ${delivery.removed > 0 ? `${delivery.removed} were removed as dead.` : 'will be retried on the next send.'}`
        : undefined),
    })
    setTitle('')
    setMessage('')
    void loadReach()
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">📣 Announcements</h2>

      <Card className="p-4 space-y-2">
        <div className="font-bold text-slate-900 text-sm">Write once, every user gets it</div>
        <div className="text-xs text-slate-600">
          The announcement appears in every user's notification list and is pushed to every phone that switched
          notifications on — with sound, even when the app is closed.
        </div>
        {reach && (
          <div className="text-xs text-slate-700 flex items-center gap-2 flex-wrap">
            <Badge color={reach.devices > 0 ? 'green' : 'amber'}>
              {reach.devices} phone{reach.devices === 1 ? '' : 's'} reachable
            </Badge>
            <span>across {reach.people} account{reach.people === 1 ? '' : 's'}</span>
            {reach.lastBatch && (
              <span className="text-slate-500">
                · last batch {reach.lastBatch.sent} sent, {reach.lastBatch.failed} failed on{' '}
                {new Date(reach.lastBatch.at).toLocaleString('en-IN')}
              </span>
            )}
          </div>
        )}
        {reach && (reach.devices === 0 || reach.devices >= ANNOUNCEMENT_WARN_DEVICES) && (
          <div className="text-xs text-slate-500">
            {reach.devices === 0
              ? 'No phone has notifications switched on yet — the announcement will still appear in every user’s app.'
              : `This will ring ${reach.devices} devices at once. Keep the message short and clear.`}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <Label htmlFor="announce-title">Title</Label>
          <Input
            id="announce-title"
            value={title}
            maxLength={100}
            placeholder="e.g. New MR vacancies posted today"
            onChange={(e) => { setTitle(e.target.value); setResult(null) }}
          />
        </div>
        <div>
          <Label htmlFor="announce-message">Message</Label>
          <Textarea
            id="announce-message"
            rows={5}
            value={message}
            placeholder="Write the announcement in simple words — it is sent exactly as typed."
            onChange={(e) => { setMessage(e.target.value); setResult(null) }}
          />
          <div className="text-[11px] text-slate-500 mt-1">
            Signed automatically as “{CREATOR.name}, {CREATOR.role}, MedRep Connect Pro”.
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
            Preview on the phone
          </div>
          <div className="text-sm font-semibold text-slate-900">{title.trim() || 'Your title'}</div>
          <div className="text-xs text-slate-700 whitespace-pre-wrap mt-1">
            {(message.trim() || 'Your message') + '\n\n' + announcementSignOff()}
          </div>
        </div>

        {result && (
          <div
            role="status"
            className={`rounded-xl px-3 py-2 text-sm font-semibold ring-1 ${
              result.kind === 'ok'
                ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
                : 'bg-red-50 text-red-900 ring-red-200'
            }`}
          >
            {result.kind === 'ok' ? '✅ ' : '⚠️ '}{result.text}
            {result.detail && <div className="text-xs font-normal mt-1">{result.detail}</div>}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs text-slate-500">
            {problem ?? `Ready to send to all users.`}
          </div>
          <Button disabled={busy || Boolean(problem)} onClick={() => { void publish() }}>
            {busy ? 'Sending…' : '📣 Send to all users'}
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="font-bold text-slate-900 text-sm">Recent sends</div>
        {!reach || reach.recent.length === 0 ? (
          <div className="text-xs text-slate-500">No announcement has been pushed yet.</div>
        ) : (
          reach.recent.map((item, index) => (
            <div key={`${item.at}-${index}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-800 truncate">{item.title || '(untitled)'}</span>
              <span className="text-slate-500 shrink-0">
                {item.sent} sent{item.failed > 0 ? ` · ${item.failed} failed` : ''} · {new Date(item.at).toLocaleString('en-IN')}
              </span>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}

// -------------------- Security (sign-in code ON/OFF) --------------------
function SecurityTab() {
  const [state, setState] = useState<AdminSecurityState | null>(null)
  const [audit, setAudit] = useState<SecurityChange[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)

  const load = useCallback(async () => {
    const [nextState, nextAudit] = await Promise.all([adminSecurityState(), adminSecurityAudit(5)])
    setState(nextState)
    setAudit(nextAudit)
  }, [])
  useEffect(() => {
    const first = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(first)
  }, [load])

  async function toggle(required: boolean) {
    setBusy(true)
    setNotice(null)
    const result = await setAdminMfaRequired(required)
    setBusy(false)
    setConfirmOff(false)
    if (!result.ok) { setNotice({ kind: 'error', text: result.error }); return }
    setState(result.state)
    setNotice({
      kind: 'ok',
      text: required
        ? 'The sign-in code is ON. Administrators must enter the six-digit code again from their next sign-in.'
        : 'The sign-in code is OFF. Administrators now open the admin panel with email and password only, until it is switched back on.',
    })
    void load()
  }

  const on = state ? state.mfaRequired : true

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">🔐 Administrator security</h2>

      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm">Sign-in code (authenticator app)</div>
            <div className="text-xs text-slate-600 mt-0.5">
              Extra six-digit code from Google Authenticator / Authy after the password. Recommended: keep it ON.
            </div>
          </div>
          <Badge color={on ? 'green' : 'red'}>{on ? 'ON' : 'OFF'}</Badge>
        </div>

        {!state ? (
          <div className="text-xs text-slate-500">Reading the current setting…</div>
        ) : (
          <>
            <div className="grid gap-1.5 text-xs text-slate-700">
              <div>
                This session: <span className="font-semibold">{state.mfaVerified ? 'code entered ✅' : 'no code entered'}</span>
                <span className="text-slate-500"> (aal {state.aal})</span>
              </div>
              {state.changedBy && (
                <div className="text-slate-500">
                  Last changed by {state.changedBy}
                  {state.changedAt ? ` on ${new Date(state.changedAt).toLocaleString('en-IN')}` : ''}.
                </div>
              )}
            </div>

            {on ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="secondary" className="px-3 py-2 text-sm" disabled={busy} onClick={() => setConfirmOff(true)}>
                  Turn the code OFF
                </Button>
                <span className="text-xs text-slate-500">
                  Use only if the authenticator is lost on every admin phone.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-xl bg-red-50 text-red-900 ring-1 ring-red-200 px-3 py-2 text-xs font-semibold">
                  Admin data is currently protected by the password alone. Anybody who knows an administrator's
                  password can open the admin panel. Switch the code back ON as soon as possible.
                </div>
                <Button className="px-3 py-2 text-sm" disabled={busy} onClick={() => { void toggle(true) }}>
                  {busy ? 'Switching on…' : 'Turn the code back ON'}
                </Button>
              </div>
            )}

            {notice && (
              <div
                role="status"
                className={`rounded-xl px-3 py-2 text-xs font-semibold ring-1 ${
                  notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-red-50 text-red-900 ring-red-200'
                }`}
              >
                {notice.text}
              </div>
            )}
          </>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <div className="font-bold text-slate-900 text-sm">Who changed it, and when</div>
        {audit.length === 0 ? (
          <div className="text-xs text-slate-500">No change has been recorded yet.</div>
        ) : (
          audit.map((change, index) => (
            <div key={`${change.changedAt}-${index}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-800">
                {change.required ? 'Switched ON' : 'Switched OFF'} by {change.changedBy}
                <span className="text-slate-500"> ({change.changedAal})</span>
              </span>
              <span className="text-slate-500 shrink-0">{new Date(change.changedAt).toLocaleString('en-IN')}</span>
            </div>
          ))
        )}
      </Card>

      <Card className="p-4 text-xs text-slate-600 space-y-1.5">
        <div className="font-bold text-slate-900 text-sm">How this is enforced</div>
        <div>
          The setting is stored on the server and read by the database itself, so it applies to every screen, every
          report and every upload — not just this console. Only an administrator can change it, and each change is
          recorded with the email and the session's code state.
        </div>
        <div>
          With the code OFF, an administrator opens the panel with email and password; the Security tab stays
          available so the code can be switched back on immediately.
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOff}
        title="Turn the sign-in code off?"
        message="Administrators will open the admin panel with email and password only, until the code is switched back on. This makes the admin panel much easier to break into — continue only if the authenticator is lost."
        confirmLabel="Turn the code off"
        danger
        onCancel={() => setConfirmOff(false)}
        onConfirm={() => { void toggle(false) }}
      />
    </div>
  )
}

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
    // Same path as the Announcements tab: store for every user, then push to
    // every subscribed phone (with sound).
    void publishToEveryone(broadcast({ kind: 'platform-update', message: text }, { type: 'update' }))
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
