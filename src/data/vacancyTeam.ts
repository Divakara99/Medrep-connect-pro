import { hasAdminRole, supabase } from './supabase'
import type { Job } from './jobs'
import { deleteReasonProblem, type ActorRole, type AuditRow } from './vacancyRules'

/**
 * Vacancy team: login accounts that only post and delete vacancies, and the
 * audit log the administrator reads. Team logins are created through the
 * admin-manage-employees function (service role on the server). Posting,
 * listing and deleting go through three database functions that check the
 * caller's role themselves.
 */

export type TeamLogin = { userId: string; email: string; name: string; createdAt: number }

export type TeamVacancy = {
  id: string
  title: string
  company: string
  location: string
  category: string
  postedAt: number
  postedBy: string
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

async function requireAdminSession(): Promise<void> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session || !hasAdminRole(session.user)) {
    throw new Error('Only a signed-in administrator can manage the vacancy team.')
  }
}

/** Calls the admin-manage-employees function and returns its JSON body. */
async function callEmployeeFunction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-manage-employees', { body })
  if (error) {
    let message = error.message || 'The team login service could not be reached.'
    const context = (error as Error & { context?: unknown }).context
    if (context instanceof Response) {
      const failure = await context.clone().json().catch(() => null) as { error?: string } | null
      if (failure?.error) message = failure.error
    }
    throw new Error(message)
  }
  const payload = (data ?? {}) as Record<string, unknown> & { error?: string }
  if (payload.error) throw new Error(payload.error)
  return payload
}

// ---------------------------------------------------------------------------
// Administrator: team logins
// ---------------------------------------------------------------------------

export async function listTeamLogins(): Promise<TeamLogin[]> {
  await requireAdminSession()
  const payload = await callEmployeeFunction({ action: 'list' })
  const rows = (payload.employees ?? []) as { user_id: string; email: string; name: string; created_at: string }[]
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    name: row.name,
    createdAt: new Date(row.created_at).getTime(),
  }))
}

export async function createTeamLogin(input: {
  email: string
  name: string
  password: string
}): Promise<Result<{ login: TeamLogin }>> {
  try {
    await requireAdminSession()
    const payload = await callEmployeeFunction({ action: 'create', ...input })
    const employee = payload.employee as { user_id: string; email: string; name: string }
    return {
      ok: true,
      login: { userId: employee.user_id, email: employee.email, name: employee.name, createdAt: Date.now() },
    }
  } catch (cause) {
    return { ok: false, error: errorText(cause, 'The team login could not be created.') }
  }
}

export async function resetTeamPassword(userId: string, password: string): Promise<Result> {
  try {
    await requireAdminSession()
    await callEmployeeFunction({ action: 'resetPassword', userId, password })
    return { ok: true }
  } catch (cause) {
    return { ok: false, error: errorText(cause, 'The password could not be changed.') }
  }
}

export async function deleteTeamLogin(userId: string): Promise<Result> {
  try {
    await requireAdminSession()
    await callEmployeeFunction({ action: 'delete', userId })
    return { ok: true }
  } catch (cause) {
    return { ok: false, error: errorText(cause, 'The team login could not be deleted.') }
  }
}

// ---------------------------------------------------------------------------
// Administrator: audit log (every vacancy added or deleted, by anyone)
// ---------------------------------------------------------------------------

type AuditDbRow = {
  id: number
  action: 'added' | 'deleted'
  vacancy_id: string
  title: string
  company: string
  location: string
  category: string
  actor_role: ActorRole
  actor_email: string
  reason: string | null
  created_at: string
}

export async function listVacancyAudit(limit = 1000): Promise<AuditRow[]> {
  await requireAdminSession()
  const { data, error } = await supabase
    .from('vacancy_audit')
    .select('id,action,vacancy_id,title,company,location,category,actor_role,actor_email,reason,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message || 'The vacancy activity could not be loaded.')
  return ((data ?? []) as unknown as AuditDbRow[]).map((row) => ({
    id: row.id,
    action: row.action,
    vacancyId: row.vacancy_id,
    title: row.title,
    company: row.company,
    location: row.location,
    category: row.category,
    actorRole: row.actor_role,
    actorEmail: row.actor_email,
    reason: row.reason,
    createdAt: new Date(row.created_at).getTime(),
  }))
}

// ---------------------------------------------------------------------------
// Vacancy team: post, list and delete
// ---------------------------------------------------------------------------

export type TeamPostFields = Omit<Job, 'id' | 'postedAt' | 'pinned' | 'postedBy'>

export async function teamPostVacancy(fields: TeamPostFields): Promise<Result<{ id: string }>> {
  const payload = {
    title: fields.title,
    company: fields.company,
    manager: fields.manager ?? '',
    contact: fields.contact ?? '',
    managerAltPhone: fields.managerAltPhone ?? '',
    managerEmail: fields.managerEmail ?? '',
    location: fields.location,
    hq: fields.hq ?? '',
    division: fields.division ?? '',
    category: fields.category,
    salary: fields.salary ?? '',
    experience: fields.experience ?? '',
    description: fields.description ?? '',
  }
  const { data, error } = await supabase.rpc('employee_post_vacancy', { p_fields: payload })
  if (error) return { ok: false, error: error.message || 'The vacancy could not be posted.' }
  return { ok: true, id: (data as { id: string }).id }
}

export async function teamListVacancies(): Promise<TeamVacancy[]> {
  const { data, error } = await supabase.rpc('employee_list_vacancies')
  if (error) throw new Error(error.message || 'Vacancies could not be loaded.')
  return ((data ?? []) as unknown as { id: string; title: string; company: string; location: string; category: string; postedAt: number; postedBy: string }[])
    .map((row) => ({
      id: row.id,
      title: row.title,
      company: row.company,
      location: row.location,
      category: row.category,
      postedAt: Number(row.postedAt) || 0,
      postedBy: row.postedBy ?? '',
    }))
}

export async function teamDeleteVacancy(id: string, reason: string): Promise<Result> {
  const problem = deleteReasonProblem(reason)
  if (problem) return { ok: false, error: problem }
  const { error } = await supabase.rpc('employee_delete_vacancy', { p_id: id, p_reason: reason.trim() })
  if (error) return { ok: false, error: error.message || 'The vacancy could not be deleted.' }
  return { ok: true }
}
