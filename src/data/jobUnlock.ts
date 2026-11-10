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
 * One vacancy, the full contact block, bought once and kept for that job — it
 * does not run out and it never renews. The server owns the price (500 paise)
 * and the permanence (`expires_at = 'infinity'`); this module only drives
 * Razorpay Checkout and waits for the verified result.
 *
 * One price, both places: ₹5 on medrepconnect.in and ₹5 inside the Android app.
 *
 * Play note, read before changing anything here: Google Play's own in-app
 * products cannot be priced below ₹10 in India, which is why this purchase is
 * NOT a Play product — it runs through Razorpay Checkout exactly as the website
 * does, and Play Billing is never opened for it. Selling in-app digital content
 * with your own payment system is only allowed on Play under the User Choice
 * Billing programme (India). While `ANDROID_IN_APP_JOB_UNLOCK` is true the app
 * shows this button; flip it to false to hide the ₹5 unlock inside the app
 * again without touching anything else.
 */
export const JOB_UNLOCK_PRICE_RUPEES = 5

/** The ₹5 unlock inside the Android app. Off = website only. */
const ANDROID_IN_APP_JOB_UNLOCK = true

/**
 * Shown wherever the ₹5 unlock can be paid — the website and, while
 * ANDROID_IN_APP_JOB_UNLOCK is on, the Android app too.
 */
export function paidJobUnlockAvailable(): boolean {
  return !isNativeApp() || ANDROID_IN_APP_JOB_UNLOCK
}

export type JobUnlockPrefill = { name?: string; email?: string }

export function jobUnlockLabel(): string {
  return `₹${JOB_UNLOCK_PRICE_RUPEES} · Unlock this job`
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
      description: `Full contact · ${(order.jobTitle || job.title).slice(0, 60)}`,
      order_id: order.orderId,
      prefill: { name: prefill.name ?? '', email: prefill.email ?? '' },
      theme: { color: '#1746bb' },
      handler: (response: RazorpayCheckoutResponse) => {
        onStage?.('verifying')
        void (async () => {
          try {
            const verified = await verifyJobUnlock(response)
            // A permanent unlock has no expiry — that is a success, not a miss.
            if (verified.ok && (verified.permanent || verified.expiresAt)) {
              succeed(verified.expiresAt ?? 'permanent')
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
