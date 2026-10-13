import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, Input, Label, Modal } from './ui'
import { ConfirmDialog } from './ConfirmDialog'
import {
  createTeamLogin,
  deleteTeamLogin,
  listTeamLogins,
  listVacancyAudit,
  resetTeamPassword,
  type TeamLogin,
} from '../data/vacancyTeam'
import { actorLabel, summarizeActivity, type AuditRow } from '../data/vacancyRules'

const dateTime = (value: number) => new Date(value).toLocaleString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

/**
 * Administrator's "Vacancy team" page: create, reset and delete the team's
 * login IDs, and see every vacancy added or deleted, with who did it and why.
 */
export function VacancyTeamAdmin() {
  const [logins, setLogins] = useState<TeamLogin[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [listView, setListView] = useState<'deleted' | 'added'>('deleted')

  // New login form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Reset password and delete
  const [resetTarget, setResetTarget] = useState<TeamLogin | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TeamLogin | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [teamLogins, activity] = await Promise.all([listTeamLogins(), listVacancyAudit()])
      setLogins(teamLogins)
      setAudit(activity)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vacancy team data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => { void reload() })
  }, [reload])

  async function create() {
    setCreateError(null)
    setNotice(null)
    if (name.trim().length < 2) return setCreateError('Enter the employee name.')
    if (!email.trim()) return setCreateError('Enter the login ID (the employee email).')
    if (password.length < 12) return setCreateError('The password must be at least 12 characters.')
    setCreating(true)
    const result = await createTeamLogin({ name: name.trim(), email: email.trim(), password })
    setCreating(false)
    if (!result.ok) {
      setCreateError(result.error)
      return
    }
    setName('')
    setEmail('')
    setPassword('')
    setNotice(`Login created for ${result.login.email}. Share the password privately.`)
    void reload()
  }

  async function saveReset() {
    if (!resetTarget) return
    setResetError(null)
    if (resetPassword.length < 12) return setResetError('The password must be at least 12 characters.')
    setResetting(true)
    const result = await resetTeamPassword(resetTarget.userId, resetPassword)
    setResetting(false)
    if (!result.ok) {
      setResetError(result.error)
      return
    }
    setNotice(`Password changed for ${resetTarget.email}.`)
    setResetTarget(null)
    setResetPassword('')
  }

  async function removeLogin() {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    setNotice(null)
    const result = await deleteTeamLogin(target.userId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotice(`Login deleted: ${target.email}. It can no longer sign in. Vacancies it posted stay in the activity log.`)
    void reload()
  }

  const summary = summarizeActivity(audit)
  const deletedRows = audit.filter((row) => row.action === 'deleted')
  const addedRows = audit.filter((row) => row.action === 'added')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-900">Vacancy team</h2>
        <Button variant="secondary" onClick={() => { void reload() }} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </div>

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900 ring-1 ring-red-200">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200">{notice}</p>}

      {/* ---- Activity totals ---- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile label="Vacancies added" value={summary.added} tone="text-emerald-700" />
        <Tile label="Added by the team" value={summary.addedByTeam} tone="text-slate-900" />
        <Tile label="Vacancies deleted" value={summary.deleted} tone="text-red-700" />
        <Tile label="Deleted by the team" value={summary.deletedByTeam} tone="text-slate-900" />
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-bold text-slate-900">Activity</h3>
          <div className="inline-flex rounded-full bg-slate-100 p-1 ring-1 ring-slate-200">
            {(['deleted', 'added'] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setListView(view)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${listView === view ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
              >
                {view === 'deleted' ? `Deleted (${deletedRows.length})` : `Added (${addedRows.length})`}
              </button>
            ))}
          </div>
        </div>

        {audit.length === 0 ? (
          <p className="text-sm text-slate-600">{loading ? 'Loading activity…' : 'No vacancy activity yet.'}</p>
        ) : listView === 'deleted' ? (
          <div className="grid md:grid-cols-[1fr_2fr] gap-3">
            <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
              <div className="bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Reason</div>
              {summary.reasons.length === 0 ? (
                <div className="px-3 py-2 text-sm text-slate-600">No deletions yet.</div>
              ) : summary.reasons.map((item) => (
                <div key={item.reason} className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-200 text-sm">
                  <span className="text-slate-800">{item.reason}</span>
                  <Badge color="red">{item.count}</Badge>
                </div>
              ))}
            </div>
            <ActivityTable
              empty="No vacancies have been deleted."
              rows={deletedRows}
              columns={['When', 'Vacancy', 'Company', 'City', 'Deleted by', 'Reason']}
              render={(row) => [
                dateTime(row.createdAt),
                row.title || '—',
                row.company || '—',
                row.location || '—',
                actorLabel(row),
                row.reason ?? '—',
              ]}
            />
          </div>
        ) : (
          <ActivityTable
            empty="No vacancies have been added."
            rows={addedRows}
            columns={['When', 'Vacancy', 'Company', 'City', 'Category', 'Added by']}
            render={(row) => [
              dateTime(row.createdAt),
              row.title || '—',
              row.company || '—',
              row.location || '—',
              row.category || '—',
              actorLabel(row),
            ]}
          />
        )}

        {summary.byActor.length > 0 && (
          <div>
            <div className="text-xs font-bold text-slate-700 mb-1">By person</div>
            <ActivityTable
              empty=""
              rows={summary.byActor}
              columns={['Who', 'Added', 'Deleted']}
              render={(row) => [row.label, String(row.added), String(row.deleted)]}
              keyOf={(row) => `${row.role}|${row.label}`}
            />
          </div>
        )}
      </Card>

      {/* ---- Team logins ---- */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-bold text-slate-900">Team logins</h3>
          <Badge color="brand">{logins.length} of 1 employee login</Badge>
        </div>

        {logins.length > 0 && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900 ring-1 ring-amber-300">
            One employee login is set up. To give vacancy access to a different person, delete this login first, then create the new one. Your admin login is never shared.
          </p>
        )}

        {logins.length === 0 && !loading && (
        <>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] items-end">
          <div>
            <Label htmlFor="team-name">Name</Label>
            <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Employee name" />
          </div>
          <div>
            <Label htmlFor="team-email">Login ID (email)</Label>
            <Input id="team-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" spellCheck={false} />
          </div>
          <div>
            <Label htmlFor="team-password">Password (12+ characters)</Label>
            <div className="flex gap-2">
              <Input id="team-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <Button variant="secondary" className="shrink-0 px-3" onClick={() => setShowPassword((v) => !v)}>{showPassword ? 'Hide' : 'Show'}</Button>
            </div>
          </div>
          <Button className="w-full md:w-auto" disabled={creating} onClick={() => { void create() }}>{creating ? 'Creating…' : 'Create login'}</Button>
        </div>
        {createError && <p role="alert" className="text-sm font-semibold text-red-800">{createError}</p>}
        </>
        )}

        {logins.length === 0 ? (
          <p className="text-sm text-slate-600">{loading ? 'Loading team logins…' : 'No team logins yet.'}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-slate-100 text-left text-slate-800">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Login ID</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {logins.map((login) => (
                  <tr key={login.userId} className="border-t border-slate-200">
                    <td className="px-3 py-2 font-semibold text-slate-900">{login.name}</td>
                    <td className="px-3 py-2 text-slate-800">{login.email}</td>
                    <td className="px-3 py-2 text-slate-700">{dateTime(login.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2 whitespace-nowrap">
                        <Button variant="secondary" onClick={() => { setResetTarget(login); setResetPassword(''); setResetError(null) }}>Reset password</Button>
                        <Button variant="danger" onClick={() => setDeleteTarget(login)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!resetTarget} onClose={() => { if (!resetting) setResetTarget(null) }} title="Reset team password">
        {resetTarget && (
          <div className="space-y-3">
            <div className="text-sm text-slate-900">Login ID: <span className="font-semibold">{resetTarget.email}</span></div>
            <div>
              <Label htmlFor="team-reset-password">New password (12+ characters)</Label>
              <Input id="team-reset-password" type="text" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} autoComplete="off" />
            </div>
            {resetError && <p role="alert" className="text-sm font-semibold text-red-800">{resetError}</p>}
            <Button className="w-full" disabled={resetting} onClick={() => { void saveReset() }}>{resetting ? 'Saving…' : 'Set new password'}</Button>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete team login?"
        message={deleteTarget ? `${deleteTarget.email} will be signed out and cannot sign in again. Vacancies it posted stay in the list and the activity log.` : ''}
        confirmLabel="Delete login"
        cancelLabel="Cancel"
        danger
        onConfirm={() => { void removeLogin() }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`text-2xl font-extrabold ${tone}`}>{value}</div>
    </Card>
  )
}

function ActivityTable<T extends object>({
  rows,
  columns,
  render,
  empty,
  keyOf,
}: {
  rows: T[]
  columns: string[]
  render: (row: T) => string[]
  empty: string
  keyOf?: (row: T) => string
}) {
  if (rows.length === 0) return empty ? <p className="text-sm text-slate-600">{empty}</p> : null
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 max-h-[420px] overflow-y-auto">
      <table className="w-full text-sm min-w-[520px]">
        <thead className="bg-slate-100 text-left text-slate-800 sticky top-0">
          <tr>
            {columns.map((column) => <th key={column} className="px-3 py-2 font-bold">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={keyOf ? keyOf(row) : index} className="border-t border-slate-200 align-top">
              {render(row).map((cell, cellIndex) => (
                <td key={cellIndex} className={`px-3 py-2 ${cellIndex === 1 ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
