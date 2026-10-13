/**
 * AI refund check: decides, before a ticket is raised, whether the reason the
 * user gives matches our refund terms and the payment record.
 *
 * This is a pure rule set with no network access. It mirrors the rules in
 * supabase/support_requests.sql (refund_verdict), and the server re-checks
 * every request, so this module only improves the conversation: the user learns
 * the outcome before a ticket is raised, and nothing is trusted from here.
 */

export type RefundReasonCode = 'captured_not_active' | 'duplicate_charge' | 'failed_but_debited'

export const REFUND_REASONS: { code: RefundReasonCode; label: string; hint: string }[] = [
  {
    code: 'captured_not_active',
    label: 'Money was deducted but my plan is not active',
    hint: 'Your bank or UPI app shows a debit, but the plan did not start.',
  },
  {
    code: 'duplicate_charge',
    label: 'I was charged twice for the same plan',
    hint: 'Two debits for one plan, within a couple of days.',
  },
  {
    code: 'failed_but_debited',
    label: 'The payment failed but money was debited',
    hint: 'The app shows a failed payment, but the amount left your account.',
  },
]

export function reasonLabel(code: RefundReasonCode): string {
  return REFUND_REASONS.find((reason) => reason.code === code)?.label ?? code
}

/** The fields of a payment that the check needs (a subset of PaymentRecord). */
export type CheckPayment = {
  id: string
  planId: string
  planTitle?: string
  amount: number
  status: 'success' | 'pending' | 'failed' | 'rejected'
  createdAt: number
  gatewayPaymentId?: string
}

export type RefundVerdict = 'eligible' | 'needs_review' | 'not_eligible'

export type RefundCheckResult = {
  verdict: RefundVerdict
  title: string
  explanation: string
  nextStep: string
}

const DUPLICATE_WINDOW_MS = 48 * 60 * 60 * 1000

export function checkRefundReason(input: {
  reasonCode: RefundReasonCode
  payment: CheckPayment
  payments: CheckPayment[]
  /** True when a refund request already exists for this payment, in any state. */
  hasRefundRequest: boolean
}): RefundCheckResult {
  const { reasonCode, payment, payments, hasRefundRequest } = input
  const reason = reasonLabel(reasonCode)

  if (hasRefundRequest) {
    return notEligible(
      'A refund request already exists for this payment',
      'We have already received a refund request for this payment, so it cannot be raised again.',
    )
  }

  if (reasonCode === 'captured_not_active') {
    if ((payment.status === 'pending' || payment.status === 'failed') && payment.gatewayPaymentId) {
      return {
        verdict: 'needs_review',
        title: 'This looks like a refund case',
        explanation: `Your payment ${payment.gatewayPaymentId} reached the gateway but our record shows the plan was not activated. An administrator will check it against the bank credit and activate the plan or refund it.`,
        nextStep: 'Raise the refund ticket so an administrator can review it.',
      }
    }
    return notEligible(
      'We cannot find a captured payment for this plan',
      `${reason}: we have no captured Razorpay payment for ${payment.planTitle ?? 'this plan'}, so it cannot be refunded as a failed capture.`,
    )
  }

  if (reasonCode === 'duplicate_charge') {
    if (payment.status !== 'success') {
      return notEligible(
        'This payment was not completed',
        'A duplicate charge applies to two completed payments. This payment is not completed, so choose the payment that was actually charged twice.',
      )
    }
    const twin = payments.find(
      (other) =>
        other.id !== payment.id &&
        other.status === 'success' &&
        other.planId === payment.planId &&
        Math.abs(other.createdAt - payment.createdAt) <= DUPLICATE_WINDOW_MS,
    )
    if (twin) {
      return {
        verdict: 'eligible',
        title: 'Duplicate charge found',
        explanation: `We found two completed payments for ${payment.planTitle ?? 'the same plan'} within 48 hours. That matches a duplicate charge.`,
        nextStep: 'Raise the refund ticket. The extra payment will be refunded to the original source.',
      }
    }
    return notEligible(
      'We cannot find a second charge for this plan',
      'Our records show only one completed payment for this plan around this time. If your bank shows two debits, choose "Something else" so an administrator can check your bank statement.',
    )
  }

  // failed_but_debited
  if (payment.status === 'pending' || payment.status === 'failed') {
    return {
      verdict: 'needs_review',
      title: 'Failed payment with a debit to check',
      explanation: 'Our record shows this payment as not completed. An administrator will compare it with your bank statement and refund any amount that was debited.',
      nextStep: 'Raise the refund ticket with your bank reference if you have one.',
    }
  }
  return notEligible(
    'This payment was completed',
    'Our record shows this payment as completed, so it is not a failed payment.',
  )
}

function notEligible(title: string, explanation: string): RefundCheckResult {
  return {
    verdict: 'not_eligible',
    title,
    explanation,
    nextStep: 'Plans are non-refundable once activated, except in the cases above. You can still raise a support request so an administrator reviews your case.',
  }
}

/** A description is only accepted once it says what happened. */
export const MIN_DESCRIPTION_LENGTH = 20

export function descriptionProblem(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length < MIN_DESCRIPTION_LENGTH) {
    return `Please describe what happened in at least ${MIN_DESCRIPTION_LENGTH} characters (date, amount and what you saw).`
  }
  return null
}
