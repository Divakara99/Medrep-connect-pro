import { supabase } from './supabase'
import type { RefundReasonCode } from './refundCheck'

/**
 * Support and refund requests, stored on the server (supabase/support_requests.sql).
 *
 * Users raise requests through create_support_request(), which adds the account
 * snapshot and re-checks refund eligibility on the server. They read only their
 * own requests, including the administrator's reply. Administrators read every
 * request and update it through admin_update_support_request().
 */

export type SupportStatus = 'open' | 'in_progress' | 'resolved'
export type AiVerdict = 'eligible' | 'needs_review' | 'not_eligible'

export type SupportRequest = {
  id: string
  kind: 'support' | 'refund'
  subject: string
  message: string
  reasonCode?: RefundReasonCode
  paymentId?: string
  aiVerdict?: AiVerdict
  status: SupportStatus
  adminReply?: string
  createdAt: number
  updatedAt?: number
  resolvedAt?: number
  /** Account snapshot written by the server, plus anything the user supplied. */
  details: Record<string, unknown>
}

type SupportRow = {
  id: string
  kind: 'support' | 'refund'
  subject: string
  message: string
  reason_code: RefundReasonCode | null
  payment_id: string | null
  ai_verdict: AiVerdict | null
  status: SupportStatus
  admin_reply: string | null
  details: Record<string, unknown> | null
  created_at: string
  updated_at: string | null
  resolved_at: string | null
}

function toRequest(row: SupportRow): SupportRequest {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    message: row.message,
    reasonCode: row.reason_code ?? undefined,
    paymentId: row.payment_id ?? undefined,
    aiVerdict: row.ai_verdict ?? undefined,
    status: row.status,
    adminReply: row.admin_reply ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).getTime() : undefined,
    details: row.details ?? {},
  }
}

const COLUMNS = 'id,kind,subject,message,reason_code,payment_id,ai_verdict,status,admin_reply,details,created_at,updated_at,resolved_at'

// In-memory only (never localStorage). Cleared on sign-out.
let requestCache: SupportRequest[] | null = null

/** The last loaded list for the signed-in user, or null if not loaded yet. */
export function getCachedSupportRequests(): SupportRequest[] | null {
  return requestCache
}

export function clearSupportCache(): void {
  requestCache = null
}

// Older builds kept support tickets in this browser only. They never reached
// the administrator, so remove them rather than let them linger on the device.
try {
  localStorage.removeItem('mrc_tickets_v1')
} catch {
  /* storage may be unavailable */
}

export type CreateResult =
  | { ok: true; request: SupportRequest }
  | { ok: false; error: string; code?: 'refund_not_eligible' }

export async function createSupportRequest(input: {
  kind: 'support' | 'refund'
  subject: string
  message: string
  reasonCode?: RefundReasonCode
  paymentId?: string
  details: Record<string, unknown>
}): Promise<CreateResult> {
  const { data, error } = await supabase.rpc('create_support_request', {
    p_kind: input.kind,
    p_subject: input.subject,
    p_message: input.message,
    p_reason_code: input.reasonCode ?? null,
    p_payment_id: input.paymentId ?? null,
    p_details: input.details,
  })
  if (error) {
    const notEligible = error.hint === 'refund_not_eligible'
    return {
      ok: false,
      code: notEligible ? 'refund_not_eligible' : undefined,
      error: error.message || 'Your request could not be sent. Please try again.',
    }
  }
  const request = toRequest(data as unknown as SupportRow)
  requestCache = [request, ...(requestCache ?? []).filter((item) => item.id !== request.id)]
  return { ok: true, request }
}

/** The signed-in user's own requests, newest first. */
export async function listMySupportRequests(): Promise<SupportRequest[]> {
  const { data, error } = await supabase
    .from('support_requests')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message || 'Your requests could not be loaded.')
  const requests = ((data ?? []) as unknown as SupportRow[]).map(toRequest)
  requestCache = requests
  return requests
}

/** Administrators only: every request, newest first. RLS enforces the check. */
export async function listAllSupportRequests(): Promise<SupportRequest[]> {
  const { data, error } = await supabase
    .from('support_requests')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) throw new Error(error.message || 'Requests could not be loaded.')
  return ((data ?? []) as unknown as SupportRow[]).map(toRequest)
}

export type UpdateResult = { ok: true; request: SupportRequest } | { ok: false; error: string }

/** Administrators only. */
export async function updateSupportRequest(id: string, status: SupportStatus, reply?: string): Promise<UpdateResult> {
  const { data, error } = await supabase.rpc('admin_update_support_request', {
    p_id: id,
    p_status: status,
    p_reply: reply?.trim() ? reply.trim() : null,
  })
  if (error) return { ok: false, error: error.message || 'The request could not be updated.' }
  return { ok: true, request: toRequest(data as unknown as SupportRow) }
}

/** Display helpers that read the server snapshot. */
export function requestEmail(request: SupportRequest): string {
  const value = request.details.accountEmail ?? request.details.email
  return typeof value === 'string' ? value : '—'
}

export function requestName(request: SupportRequest): string {
  const value = request.details.name
  return typeof value === 'string' && value.trim() ? value : '—'
}

/** Ticket number shown to the user, e.g. "#A1B2C". */
export function ticketNumber(id: string): string {
  return id.replace(/-/g, '').slice(-5).toUpperCase()
}
