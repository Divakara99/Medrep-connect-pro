import { supabase } from './supabase'

export type RazorpayOrder = {
  ok: true
  paymentRecordId: string
  orderId: string
  amount: number
  currency: 'INR'
  keyId: string
  planId: string
  planTitle: string
  planDays: number
}

export type RazorpayCheckoutResponse = {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

export type RazorpayVerification = {
  ok: boolean
  activated: boolean
  expiresAt?: string
  planId?: string
  planDays?: number
  gatewayPaymentId?: string
  utr?: string | null
  message?: string
  paymentStatus?: string
}

type RazorpayOptions = {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  prefill: { name: string; email: string }
  theme: { color: string }
  handler: (response: RazorpayCheckoutResponse) => void
  modal: { ondismiss: () => void }
}

type RazorpayInstance = {
  open: () => void
  on: (event: string, callback: (response: { error?: { description?: string } }) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
  }
}

let checkoutScriptPromise: Promise<void> | null = null

export function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  if (checkoutScriptPromise) return checkoutScriptPromise

  checkoutScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout]')
    const script = existing ?? document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.dataset.razorpayCheckout = 'true'
    script.onload = () => {
      if (window.Razorpay) resolve()
      else reject(new Error('Razorpay Checkout could not be loaded.'))
    }
    script.onerror = () => {
      checkoutScriptPromise = null
      reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.'))
    }
    if (!existing) document.head.appendChild(script)
  })

  return checkoutScriptPromise
}

async function invoke<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body })
  if (error) {
    const context = (error as Error & { context?: unknown }).context
    if (context instanceof Response) {
      let serverMessage = ''
      try {
        const payload = await context.clone().json() as { error?: string }
        if (typeof payload.error === 'string') serverMessage = payload.error
      } catch {
        // Keep the SDK message when the function response is not JSON.
      }
      if (serverMessage) throw new Error(serverMessage)
    }
    throw new Error(error.message || 'Secure payment service is unavailable.')
  }
  if (!data) throw new Error('Secure payment service returned no response.')
  if (typeof data.error === 'string') throw new Error(data.error)
  return data as T
}

export function createRazorpayOrder(planId: string): Promise<RazorpayOrder> {
  return invoke<RazorpayOrder>('create-razorpay-order', { planId })
}

export function verifyRazorpayPayment(input: RazorpayCheckoutResponse): Promise<RazorpayVerification> {
  return invoke<RazorpayVerification>('verify-razorpay-payment', {
    orderId: input.razorpay_order_id,
    paymentId: input.razorpay_payment_id,
    signature: input.razorpay_signature,
  })
}

// Only for legacy manual requests already created before direct UPI was retired.
export async function submitManualUpiUtr(paymentRecordId: string, utr: string): Promise<void> {
  const result = await invoke<{ ok: boolean; pendingVerification: boolean }>('submit-upi-utr', {
    paymentRecordId,
    utr,
  })
  if (!result.ok || !result.pendingVerification) {
    throw new Error('Your UPI reference could not be submitted. Please try again.')
  }
}

export function openRazorpayCheckout(options: RazorpayOptions): RazorpayInstance {
  if (!window.Razorpay) throw new Error('Razorpay Checkout is not ready. Please try again.')
  return new window.Razorpay(options)
}
