import { remove } from './storage'
import { broadcast } from './notifications'
import { supabase } from './supabase'

export type PaymentRecord = {
  id: string
  userId: string
  planId: string
  planTitle?: string
  amount: number
  status: 'success' | 'pending' | 'failed' | 'rejected'
  createdAt: number
  planDays?: number
  expiresAt?: number
  txRef?: string
  gatewayPaymentId?: string
  orderId?: string
  activated?: boolean
  utr?: string
  paymentMethod?: 'Razorpay' | 'UPI' | 'Manual grant'
  manualReview?: boolean
  refundStatus?: 'none' | 'requested' | 'approved' | 'rejected'
  refundRef?: string
  refundMethod?: 'Razorpay' | 'UPI' | 'Other'
  refundAt?: number
}

type SubscriptionPaymentRow = {
  id: string
  user_id: string
  plan_id: string
  plan_title: string
  plan_days: number
  amount_paise: number | string
  payment_method: 'razorpay' | 'upi_manual' | 'manual_grant'
  payment_status: 'pending' | 'manual_review' | 'paid' | 'failed' | 'rejected'
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  upi_reference: string | null
  utr: string | null
  created_at: string
  paid_at: string | null
  expires_at: string | null
}

const LEGACY_METHODS_KEY = 'mrc_payment_methods_v1'
const LEGACY_PAYMENTS_KEY = 'mrc_payments_v1'
const VERIFIED_PAYMENT_CACHE_KEY = 'mrc_verified_payment_cache_v1'

// Remove the old local-only payment simulation and any Razorpay secret that
// may have been entered into the former Admin payment form. Neither browser
// storage nor the UI is an authority for payment status or entitlements.
// Keep fetched records in memory only, not cross-account browser storage.
remove(LEGACY_METHODS_KEY)
remove(LEGACY_PAYMENTS_KEY)
remove(VERIFIED_PAYMENT_CACHE_KEY)

let paymentCache: PaymentRecord[] = []
let cacheGeneration = 0

export function clearPaymentCache(): void {
  ++cacheGeneration
  paymentCache = []
}

function toPaymentRecord(row: SubscriptionPaymentRow): PaymentRecord {
  const paid = row.payment_status === 'paid'
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    planTitle: row.plan_title,
    amount: Number(row.amount_paise) / 100,
    status: paid ? 'success' : row.payment_status === 'rejected' ? 'rejected' : row.payment_status === 'failed' ? 'failed' : 'pending',
    createdAt: new Date(row.created_at).getTime(),
    planDays: row.plan_days,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : undefined,
    txRef: row.razorpay_payment_id ?? row.upi_reference ?? undefined,
    gatewayPaymentId: row.razorpay_payment_id ?? undefined,
    orderId: row.razorpay_order_id ?? undefined,
    activated: paid,
    utr: row.utr ?? undefined,
    paymentMethod: row.payment_method === 'upi_manual' ? 'UPI' : row.payment_method === 'manual_grant' ? 'Manual grant' : 'Razorpay',
    manualReview: row.payment_status === 'manual_review',
    refundStatus: 'none',
  }
}

export function getPayments(): PaymentRecord[] {
  return paymentCache
}

export async function refreshPayments(): Promise<PaymentRecord[]> {
  const requestGeneration = cacheGeneration
  const { data, error } = await supabase
    .from('subscription_payments')
    .select('id,user_id,plan_id,plan_title,plan_days,amount_paise,payment_method,payment_status,razorpay_order_id,razorpay_payment_id,upi_reference,utr,created_at,paid_at,expires_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error

  const records = ((data ?? []) as unknown as SubscriptionPaymentRow[]).map(toPaymentRecord)
  if (requestGeneration === cacheGeneration) paymentCache = records
  return records
}

export function getPaymentsByUser(userId: string): PaymentRecord[] {
  return getPayments().filter((payment) => payment.userId === userId)
}

/**
 * Keep the existing ticket flow usable without pretending that a refund has
 * been processed. Refund status shown here is local UI state only; actual
 * refunds still require an authorized Razorpay dashboard/API action.
 */
export function requestRefund(userId: string): PaymentRecord | null {
  const payments = getPayments()
  const index = payments.findIndex((payment) => payment.userId === userId && payment.status === 'success')
  if (index < 0) return null
  const updated = { ...payments[index], refundStatus: 'requested' as const }
  payments[index] = updated
  paymentCache = payments
  return updated
}

export function resolveRefund(
  paymentId: string,
  options: { approve: boolean; refundRef?: string; refundMethod?: PaymentRecord['refundMethod'] },
): PaymentRecord | null {
  const payments = getPayments()
  const index = payments.findIndex((payment) => payment.id === paymentId)
  if (index < 0) return null
  const updated: PaymentRecord = {
    ...payments[index],
    refundStatus: options.approve ? 'approved' : 'rejected',
    refundRef: options.approve ? options.refundRef?.trim() || payments[index].refundRef : payments[index].refundRef,
    refundMethod: options.approve ? options.refundMethod ?? 'Razorpay' : payments[index].refundMethod,
    refundAt: options.approve ? Date.now() : payments[index].refundAt,
  }
  payments[index] = updated
  paymentCache = payments
  if (options.approve) {
    broadcast({
      kind: 'refund-processed',
      amount: updated.amount,
      refundRef: updated.refundRef ?? '',
      method: updated.refundMethod ?? 'Razorpay',
    }, { type: 'payment', meta: { paymentId: updated.id, txRef: updated.txRef } })
  }
  return updated
}

export async function reviewManualUpiPayment(paymentRecordId: string, approve: boolean): Promise<void> {
  const { data, error } = await supabase.functions.invoke('review-manual-upi-payment', {
    body: { paymentRecordId, approve },
  })
  if (error) throw new Error(await edgeFunctionError(error, 'Could not review the UPI payment.'))
  if (!data?.ok) throw new Error(data?.error || 'Could not review the UPI payment.')
  await refreshPayments()
}

export async function edgeFunctionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as Error & { context?: unknown })?.context
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: string }
      if (payload.error) return payload.error
    } catch {
      // Use the SDK's error message below if the function did not return JSON.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback
}
