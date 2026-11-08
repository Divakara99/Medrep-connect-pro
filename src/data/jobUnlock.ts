import { isNativeApp } from './platform'
import {
  createJobUnlockOrder,
  loadRazorpayCheckout,
  openRazorpayCheckout,
  verifyJobUnlock,
  type RazorpayCheckoutResponse,
} from './razorpay'

/**
 * The ₹5 single-job unlock.
 *
 * One vacancy, the full contact block, one hour — bought once, never renewed
 * automatically. The server owns both the price (500 paise) and the window
 * (60 minutes); this module only drives Razorpay Checkout and waits for the
 * verified result.
 *
 * Play-only note: Google Play's lowest in-app price in India is ₹10, so a ₹5
 * purchase cannot exist inside the Android app. There the rewarded video
 * (company name, 10 minutes) stays the free path, and this paid unlock is sold
 * on the website through Razorpay/UPI where ₹5 is a normal amount.
 */
export const JOB_UNLOCK_PRICE_RUPEES = 5
export const JOB_UNLOCK_MINUTES = 60

/** Paid unlocks are a website feature; the Play build must not open Razorpay. */
export function paidJobUnlockAvailable(): boolean {
  return !isNativeApp()
}

export type JobUnlockPrefill = { name?: string; email?: string }

export function jobUnlockLabel(): string {
  return `₹${JOB_UNLOCK_PRICE_RUPEES} · Full contact for 1 hour`
}

/**
 * Runs the whole purchase and resolves with the server-stamped expiry.
 * Every failure path rejects with a sentence the sheet can show as-is, and
 * says plainly when nothing was charged.
 */
export async function buyJobUnlock(
  job: { id: string; title: string },
  prefill: JobUnlockPrefill,
  onStage?: (stage: 'opening' | 'paying' | 'verifying') => void,
): Promise<string> {
  if (isNativeApp()) {
    throw new Error('The ₹5 unlock is only available on medrepconnect.in. In the app, watch the short video to see the company name.')
  }

  onStage?.('opening')
  await loadRazorpayCheckout()
  const order = await createJobUnlockOrder(job.id)

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const fail = (message: string) => {
      if (settled) return
      settled = true
      reject(new Error(message))
    }
    const succeed = (expiresAt: string) => {
      if (settled) return
      settled = true
      resolve(expiresAt)
    }

    const checkout = openRazorpayCheckout({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: 'MedRep Connect Pro',
      description: `Full contact · ${(order.jobTitle || job.title).slice(0, 60)} · 1 hour`,
      order_id: order.orderId,
      prefill: { name: prefill.name ?? '', email: prefill.email ?? '' },
      theme: { color: '#1746bb' },
      handler: (response: RazorpayCheckoutResponse) => {
        onStage?.('verifying')
        void (async () => {
          try {
            const verified = await verifyJobUnlock(response)
            if (verified.ok && verified.expiresAt) {
              succeed(verified.expiresAt)
              return
            }
            fail(verified.message
              || 'Razorpay has not confirmed this payment yet. Do not pay again — reopen this job in a minute.')
          } catch (error) {
            fail(error instanceof Error
              ? `Payment returned by Razorpay, but verification is pending. Do not pay again. ${error.message}`
              : 'Payment verification is pending. Do not pay again; reopen this job in a minute.')
          }
        })()
      },
      modal: {
        ondismiss: () => fail('Payment cancelled. Nothing was charged.'),
      },
    })
    checkout.on('payment.failed', () => {
      fail('The payment did not go through. Nothing was charged — you can try again.')
    })
    onStage?.('paying')
    checkout.open()
  })
}
