type RazorpayOrderResponse = {
  id: string
  amount: number
  currency: string
  status: string
  receipt?: string
}

export type RazorpayPayment = {
  id: string
  entity?: string
  amount: number
  currency: string
  status: string
  order_id: string | null
  method?: string
  acquirer_data?: { rrn?: string; [key: string]: unknown }
}

// Razorpay key IDs are public checkout identifiers; the supplied live key ID
// can be overridden at deploy time. The matching private secret is never bundled.
const DEFAULT_RAZORPAY_KEY_ID = 'rzp_live_DYPHachvqO71iH'

export function razorpayCredentials() {
  const keyId = Deno.env.get('RAZORPAY_KEY_ID')?.trim() || DEFAULT_RAZORPAY_KEY_ID
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')?.trim()
  if (!keySecret) throw new Error('Razorpay server credentials are not configured.')
  return { keyId, keySecret }
}

function basicAuthorization(keyId: string, keySecret: string): string {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`
}

export async function createRazorpayOrder(input: {
  amountPaise: number
  currency: 'INR'
  receipt: string
  notes: Record<string, string>
}): Promise<RazorpayOrderResponse> {
  const { keyId, keySecret } = razorpayCredentials()
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: basicAuthorization(keyId, keySecret),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  const payload = await response.json().catch(() => null) as RazorpayOrderResponse | null
  if (!response.ok || !payload?.id) {
    throw new Error('Razorpay could not create the payment order. Check the server credentials and merchant account.')
  }
  if (payload.amount !== input.amountPaise || payload.currency !== 'INR') {
    throw new Error('Razorpay returned an order that does not match the selected plan.')
  }
  return payload
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  const { keyId, keySecret } = razorpayCredentials()
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: basicAuthorization(keyId, keySecret) },
  })
  const payload = await response.json().catch(() => null) as RazorpayPayment | null
  if (!response.ok || !payload?.id) {
    throw new Error('Razorpay could not confirm this payment. Please try checking its status again.')
  }
  return payload
}

export async function captureRazorpayPayment(paymentId: string, amountPaise: number): Promise<void> {
  const { keyId, keySecret } = razorpayCredentials()
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthorization(keyId, keySecret),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR' }),
  })
  if (!response.ok) {
    throw new Error('Razorpay capture is still pending; payment must be captured before activating a plan.')
  }
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export async function verifyCheckoutSignature(
  secret: string,
  orderId: string,
  paymentId: string,
  suppliedSignature: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, `${orderId}|${paymentId}`)
  return constantTimeEqual(expected, suppliedSignature.trim().toLowerCase())
}
