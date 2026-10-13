import assert from 'node:assert/strict'
import { checkRefundReason, descriptionProblem } from '../src/data/refundCheck.ts'

/**
 * AI refund check (client rules, mirrored by supabase/support_requests.sql):
 *   captured but not active -> needs review; duplicate -> eligible only with a
 *   second completed payment for the same plan within 48 hours; failed but
 *   debited -> needs review; completed or already-requested payments -> not eligible.
 */
const now = Date.UTC(2026, 9, 13)
const day = 24 * 60 * 60 * 1000
const pay = (id, status, overrides = {}) => ({
  id,
  planId: 'p15',
  planTitle: '15 Days Pro',
  amount: 149,
  status,
  createdAt: now - day,
  ...overrides,
})

const pending = pay('a', 'pending', { gatewayPaymentId: 'pay_1' })
assert.equal(
  checkRefundReason({ reasonCode: 'captured_not_active', payment: pending, payments: [pending], hasRefundRequest: false }).verdict,
  'needs_review',
)
assert.equal(
  checkRefundReason({ reasonCode: 'captured_not_active', payment: pay('b', 'pending'), payments: [], hasRefundRequest: false }).verdict,
  'not_eligible',
  'no gateway payment id means no captured payment to refund',
)
assert.equal(
  checkRefundReason({ reasonCode: 'captured_not_active', payment: pending, payments: [pending], hasRefundRequest: true }).verdict,
  'not_eligible',
  'a second request for the same payment is refused',
)

const first = pay('c', 'success')
const twin = pay('d', 'success', { createdAt: now - day + 60 * 60 * 1000 })
assert.equal(
  checkRefundReason({ reasonCode: 'duplicate_charge', payment: first, payments: [first, twin], hasRefundRequest: false }).verdict,
  'eligible',
)
assert.equal(
  checkRefundReason({ reasonCode: 'duplicate_charge', payment: first, payments: [first], hasRefundRequest: false }).verdict,
  'not_eligible',
  'one completed payment is not a duplicate',
)
const farTwin = pay('e', 'success', { createdAt: now - 10 * day })
assert.equal(
  checkRefundReason({ reasonCode: 'duplicate_charge', payment: first, payments: [first, farTwin], hasRefundRequest: false }).verdict,
  'not_eligible',
  'payments more than 48 hours apart are not a duplicate',
)
assert.equal(
  checkRefundReason({ reasonCode: 'duplicate_charge', payment: pay('f', 'failed'), payments: [], hasRefundRequest: false }).verdict,
  'not_eligible',
)

assert.equal(
  checkRefundReason({ reasonCode: 'failed_but_debited', payment: pay('g', 'failed'), payments: [], hasRefundRequest: false }).verdict,
  'needs_review',
)
assert.equal(
  checkRefundReason({ reasonCode: 'failed_but_debited', payment: first, payments: [first], hasRefundRequest: false }).verdict,
  'not_eligible',
  'a completed payment is not a failed payment',
)

assert.match(descriptionProblem('too short'), /at least 20 characters/)
assert.equal(descriptionProblem('Money debited on 12 Oct, plan did not start.'), null)

console.log('refund check: duplicate window, gateway capture, failed debits and repeat requests passed')
