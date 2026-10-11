import { read, write } from './storage'
import { broadcast } from './notifications'
import { subscribeUser } from './auth'
import { getPlans } from './plans'
import { mirror } from './supabase'

export type PaymentMethod = {
  id: string
  mode: 'Razorpay' | 'UPI'
  label: string
  razorpayKey?: string
  razorpaySecret?: string
  upiVpa?: string
  isDefault?: boolean
  createdAt: number
}

export type PaymentRecord = {
  id: string
  userId: string
  planId: string
  amount: number
  methodId?: string
  status: 'success' | 'pending' | 'failed'
  createdAt: number
  // Transaction + auto-activation details (synced to admin / Supabase-ready)
  planDays?: number
  expiresAt?: number
  txRef?: string
  activated?: boolean
  // UPI/NEFT unique transaction reference entered by the user at checkout
  utr?: string
  // Refund lifecycle — admin approves refunds via the Payments tab
  refundStatus?: 'none' | 'requested' | 'approved' | 'rejected'
  refundRef?: string
  refundMethod?: 'Razorpay' | 'UPI' | 'Other'
  refundAt?: number
}

const METHODS_KEY = 'mrc_payment_methods_v1'
const PAYMENTS_KEY = 'mrc_payments_v1'

function pid(prefix = 'pm') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9)
}

export function getPaymentMethods(): PaymentMethod[] {
  return read<PaymentMethod[]>(METHODS_KEY, [])
}

export function savePaymentMethod(
  m: Omit<PaymentMethod, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): PaymentMethod {
  const methods = getPaymentMethods()
  const isFirst = methods.length === 0
  const pm: PaymentMethod = {
    id: m.id || pid(),
    mode: m.mode,
    label: m.label.trim() || (m.mode === 'UPI' ? 'UPI' : 'Razorpay'),
    razorpayKey: m.razorpayKey?.trim(),
    razorpaySecret: m.razorpaySecret?.trim(),
    upiVpa: m.upiVpa?.trim(),
    isDefault: m.isDefault ?? isFirst,
    createdAt: m.createdAt || Date.now(),
  }
  // If this one is default, unset others.
  const next: PaymentMethod[] = methods.map((x) => ({ ...x, isDefault: pm.isDefault ? false : x.isDefault }))
  const idx = next.findIndex((x) => x.id === pm.id)
  if (idx >= 0) next[idx] = pm
  else next.unshift(pm)
  write(METHODS_KEY, next)
  broadcast({ kind: 'payments-updated' }, { type: 'payment' })
  return pm
}

export function deletePaymentMethod(id: string) {
  const methods = getPaymentMethods().filter((m) => m.id !== id)
  // If we deleted the default, promote the first.
  if (!methods.some((m) => m.isDefault) && methods.length > 0) methods[0].isDefault = true
  write(METHODS_KEY, methods)
}

export function setDefaultPaymentMethod(id: string) {
  const methods = getPaymentMethods().map((m) => ({ ...m, isDefault: m.id === id }))
  write(METHODS_KEY, methods)
}

export function getDefaultPaymentMethod(): PaymentMethod | undefined {
  return getPaymentMethods().find((m) => m.isDefault)
}

export function getPayments(): PaymentRecord[] {
  return read<PaymentRecord[]>(PAYMENTS_KEY, [])
}

export function recordPayment(rec: Omit<PaymentRecord, 'id' | 'createdAt' | 'status' | 'planDays' | 'expiresAt' | 'txRef' | 'activated' | 'refundStatus'> & {
  status?: PaymentRecord['status']
  planDays?: number
  txRef?: string
  utr?: string
}): PaymentRecord {
  const all = getPayments()
  // Resolve plan days (from explicit param or plan definition)
  const plan = getPlans().find((p) => p.id === rec.planId)
  const days = rec.planDays ?? plan?.days ?? 30
  const confirmed = (rec.status || 'success') === 'success'
  const expiresAt = confirmed ? Date.now() + days * 24 * 60 * 60 * 1000 : undefined
  const r: PaymentRecord = {
    id: pid('pay'),
    userId: rec.userId,
    planId: rec.planId,
    amount: rec.amount,
    methodId: rec.methodId,
    status: rec.status || 'success',
    createdAt: Date.now(),
    planDays: days,
    expiresAt,
    txRef: rec.txRef || 'TXN' + Date.now().toString(36).toUpperCase(),
    activated: confirmed,
    utr: rec.utr?.trim() || undefined,
    refundStatus: 'none',
  }
  all.unshift(r)
  write(PAYMENTS_KEY, all)
  mirror('payments', r)

  // AUTO-ACTIVATE the plan with expiry date as per the plan days once the
  // transaction is confirmed — then notify the user and the admin feed.
  if (confirmed) {
    const updated = subscribeUser(rec.userId, days)
    if (updated) {
      broadcast({
        kind: 'payment-confirmed',
        planName: plan?.title ?? 'Premium',
        days,
        expiresAt: expiresAt!,
        amount: rec.amount,
      }, { type: 'payment', target: 'all', meta: { userId: rec.userId, txRef: r.txRef } })
    }
  }
  return r
}

/** All payments of one user (newest first) — for the user's own payment monitor. */
export function getPaymentsByUser(userId: string): PaymentRecord[] {
  return getPayments().filter((p) => p.userId === userId)
}

/** User raises a refund request on their latest confirmed payment. */
export function requestRefund(userId: string): PaymentRecord | null {
  const all = getPayments()
  const idx = all.findIndex((p) => p.userId === userId && p.status === 'success' && (!p.refundStatus || p.refundStatus === 'none' || p.refundStatus === 'rejected'))
  if (idx === -1) return null
  all[idx] = { ...all[idx], refundStatus: 'requested' }
  write(PAYMENTS_KEY, all)
  mirror('payments', all[idx])
  return all[idx]
}

/**
 * Admin decision on a refund request (Payments tab).
 * `refundRef` is the Razorpay payment ID / UPI UTR used to actually process
 * the money movement in the gateway or bank app.
 */
export function resolveRefund(
  paymentId: string,
  opts: { approve: boolean; refundRef?: string; refundMethod?: PaymentRecord['refundMethod'] },
): PaymentRecord | null {
  const all = getPayments()
  const idx = all.findIndex((p) => p.id === paymentId)
  if (idx === -1) return null
  const updated: PaymentRecord = {
    ...all[idx],
    refundStatus: opts.approve ? 'approved' : 'rejected',
    refundRef: opts.approve ? (opts.refundRef?.trim() || all[idx].refundRef || 'REF' + Date.now().toString(36).toUpperCase()) : all[idx].refundRef,
    refundMethod: opts.approve ? (opts.refundMethod ?? 'Razorpay') : all[idx].refundMethod,
    refundAt: opts.approve ? Date.now() : all[idx].refundAt,
  }
  all[idx] = updated
  write(PAYMENTS_KEY, all)
  mirror('payments', updated)
  if (opts.approve) {
    broadcast({
      kind: 'refund-processed',
      amount: updated.amount,
      refundRef: updated.refundRef ?? '',
      method: updated.refundMethod ?? 'Razorpay',
    }, { type: 'payment', meta: { paymentId: updated.id, txRef: updated.txRef } })
  }
  return updated
}
