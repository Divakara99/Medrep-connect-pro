import { useCallback, useEffect, useMemo, useState } from 'react'
import { BackButton, Badge, Button, Card, Input, Label, Modal, Textarea } from '../components/ui'
import { Wordmark } from '../components/Logo'
import { VacancyForm } from '../components/VacancyForm'
import { currentUser } from '../data/auth'
import { deleteReasonProblem } from '../data/vacancyRules'
import { teamAnswerFillCheck, teamDeleteVacancy, teamListVacancies, type TeamVacancy } from '../data/vacancyTeam'
import { fillCheckWaiting } from '../data/fillCheck'

/**
 * The vacancy team's only page: post a vacancy, see the active vacancies and
 * delete one with a reason. Nothing else in the app is available to this login.
 */
export function VacancyPortal({ onExit }: { onExit: () => void }) {
  const me = currentUser()?.email?.toLowerCase() ?? ''
  const [vacancies, setVacancies] = useState<TeamVacancy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [posting, setPosting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TeamVacancy | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setVacancies(await teamListVacancies())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vacancies could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => { void load() })
  }, [load])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vacancies
    return vacancies.filter((v) => `${v.title} ${v.company} ${v.location} ${v.category}`.toLowerCase().includes(q))
  }, [vacancies, search])

  const postedByMe = vacancies.filter((v) => v.postedBy.toLowerCase() === me).length
  // The administrator's questions, newest first — the first thing on the page.
  const pendingQuestions = vacancies
    .filter((vacancy) => fillCheckWaiting(vacancy.fillCheck))
    .sort((a, b) => (b.fillCheck?.askedAt ?? 0) - (a.fillCheck?.askedAt ?? 0))
  const [answeringId, setAnsweringId] = useState<string | null>(null)

  async function answer(target: TeamVacancy, answer: 'open' | 'filled') {
    setAnsweringId(target.id)
    setError(null)
    const result = await teamAnswerFillCheck(target.id, answer)
    setAnsweringId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotice(`Told the administrator that “${target.title}” is ${answer === 'filled' ? 'filled' : 'still open'}.`)
    void load()
  }
  const reasonProblem = reason.trim() ? deleteReasonProblem(reason) : null

  async function confirmDelete() {
    if (!deleteTarget || deleteReasonProblem(reason)) return
    setBusy(true)
    setError(null)
    const result = await teamDeleteVacancy(deleteTarget.id, reason)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotice(`Deleted "${deleteTarget.title}". The administrator can see the reason in the activity log.`)
    setDeleteTarget(null)
    setReason('')
    void load()
  }

  return (
    <div className="min-h-[100dvh]">
      <header className="glass-bar sticky top-0 z-20 border-b border-white/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <BackButton onClick={onExit} label="Sign out of the employee portal" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><Wordmark size="text-sm" /><Badge color="green">Vacancy team</Badge></div>
            <div className="text-xs text-slate-500 truncate">{currentUser()?.email}</div>
          </div>
          <Button variant="secondary" onClick={onExit}>Sign out</Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2 flex-wrap">
            <Badge color="brand">{vacancies.length} active vacancies</Badge>
            <Badge color="slate">{postedByMe} posted by you</Badge>
          </div>
          <Button onClick={() => setPosting(true)}>+ Post vacancy</Button>
        </div>

        {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200">{notice}</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900 ring-1 ring-red-200">{error}</p>}

        {pendingQuestions.length > 0 && (
          <Card className="space-y-3 border-amber-200 bg-amber-50/60 p-4 ring-1 ring-amber-200">
            <div>
              <div className="text-sm font-bold text-amber-950">
                📩 The administrator asks about {pendingQuestions.length} vacanc{pendingQuestions.length === 1 ? 'y' : 'ies'}
              </div>
              <p className="text-xs font-medium text-amber-900">
                Is it still open, or has it been filled? The answer decides whether the vacancy stays or is deleted.
              </p>
            </div>
            <div className="space-y-2">
              {pendingQuestions.map((vacancy) => (
                <div key={vacancy.id} className="rounded-xl bg-white p-3 ring-1 ring-amber-200">
                  <div className="truncate text-sm font-semibold text-slate-900">{vacancy.title}</div>
                  <div className="truncate text-xs text-slate-600">{vacancy.company} · {vacancy.location}</div>
                  {vacancy.fillCheck?.askedAt && (
                    <div className="text-[11px] text-slate-500">
                      Asked {new Date(vacancy.fillCheck.askedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      {vacancy.fillCheck.askedBy ? ` by ${vacancy.fillCheck.askedBy}` : ''}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      className="px-3 py-1.5 text-xs"
                      disabled={answeringId === vacancy.id}
                      onClick={() => { void answer(vacancy, 'open') }}
                    >
                      ✅ Still open
                    </Button>
                    <Button
                      variant="secondary"
                      className="px-3 py-1.5 text-xs"
                      disabled={answeringId === vacancy.id}
                      onClick={() => { void answer(vacancy, 'filled') }}
                    >
                      🚫 Filled
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div>
          <Label htmlFor="vacancy-search">Find a vacancy</Label>
          <Input
            id="vacancy-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Title, company, city or category"
          />
        </div>

        {loading && vacancies.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-600">Loading vacancies…</Card>
        ) : visible.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-600">
            {vacancies.length === 0 ? 'No active vacancies. Use “Post vacancy” to add one.' : 'No vacancy matches this search.'}
          </Card>
        ) : (
          <div className="grid gap-2">
            {visible.map((vacancy) => (
              <Card key={vacancy.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 truncate">{vacancy.title}</span>
                      <Badge color="brand">{vacancy.category}</Badge>
                    </div>
                    <div className="text-xs text-slate-600 truncate">{vacancy.company} · {vacancy.location}</div>
                    {(vacancy.qualification || vacancy.ageLimit || vacancy.vacancyCount) && (
                      <div className="text-xs text-slate-600 mt-1">
                        {[vacancy.qualification, vacancy.ageLimit, vacancy.vacancyCount].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-400">
                      Posted {vacancy.postedAt ? new Date(vacancy.postedAt).toLocaleString('en-IN') : '—'}
                      {vacancy.postedBy ? ` · by ${vacancy.postedBy}` : ''}
                    </div>
                  </div>
                  <Button variant="danger" className="shrink-0" onClick={() => { setError(null); setNotice(null); setDeleteTarget(vacancy) }}>
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      <VacancyForm
        key={posting ? 'post-open' : 'post-closed'}
        mode="team"
        job={null}
        open={posting}
        onClose={() => setPosting(false)}
        onSaved={() => {
          setPosting(false)
          setNotice('Vacancy posted. Users have been notified.')
          void load()
        }}
      />

      <Modal open={!!deleteTarget} onClose={() => { if (!busy) { setDeleteTarget(null); setReason('') } }} title="Delete vacancy">
        {deleteTarget && (
          <div className="space-y-3">
            <div className="text-sm text-slate-900">
              <span className="font-semibold">{deleteTarget.title}</span> · {deleteTarget.company} · {deleteTarget.location}
            </div>
            <div>
              <Label htmlFor="team-delete-reason">Reason for deleting</Label>
              <Textarea
                id="team-delete-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Position filled, duplicate entry, closed by employer"
              />
              <div className="mt-1 text-xs text-slate-600">Required · 5 to 300 characters · the administrator sees it.</div>
            </div>
            {reasonProblem && <p role="alert" className="text-sm font-semibold text-red-800">{reasonProblem}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => { setDeleteTarget(null); setReason('') }}>Cancel</Button>
              <Button variant="danger" className="flex-1" disabled={!!deleteReasonProblem(reason) || busy} onClick={() => { void confirmDelete() }}>
                {busy ? 'Deleting…' : 'Delete vacancy'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
