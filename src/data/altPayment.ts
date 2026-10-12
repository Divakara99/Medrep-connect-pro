import { mirror } from './supabase'
import { read, write } from './storage'

/**
 * Alternative payment details (manual UPI ID / bank transfer) configured by
 * the admin. Razorpay Checkout is the default path; these details are an
 * optional fallback and always require manual admin verification before any
 * access is granted.
 */
export type AltPaymentDetails = {
  upiId: string
  bankDetails: string
  instructions: string
  updatedAt?: number
}

const ALT_PAYMENT_KEY = 'mrc_alt_payment_v1'
const EMPTY: AltPaymentDetails = { upiId: '', bankDetails: '', instructions: '' }

export function getAltPaymentDetails(): AltPaymentDetails {
  const saved = read<Partial<AltPaymentDetails>>(ALT_PAYMENT_KEY, {})
  return {
    upiId: typeof saved.upiId === 'string' ? saved.upiId : '',
    bankDetails: typeof saved.bankDetails === 'string' ? saved.bankDetails : '',
    instructions: typeof saved.instructions === 'string' ? saved.instructions : '',
    updatedAt: typeof saved.updatedAt === 'number' ? saved.updatedAt : undefined,
  }
}

export function hasAltPaymentDetails(): boolean {
  const details = getAltPaymentDetails()
  return Boolean(details.upiId.trim() || details.bankDetails.trim())
}

export function saveAltPaymentDetails(details: Omit<AltPaymentDetails, 'updatedAt'>): AltPaymentDetails {
  const next: AltPaymentDetails = { ...EMPTY, ...details, updatedAt: Date.now() }
  write(ALT_PAYMENT_KEY, next)
  mirror('plans', { id: 'alt-payment-details', ...next })
  return next
}
