import { jsonResponse } from '../_shared/http.ts'
import { optionsResponse } from '../_shared/supabase.ts'

// Direct merchant-VPA links disclose the payee address and cannot prove that
// a transfer completed. New UPI payments must go through Razorpay Checkout,
// with captured status verified server-side. Deploy this replacement to retire
// any previously deployed version of this endpoint that returned the VPA.
Deno.serve((request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)
  return jsonResponse({ error: 'Direct UPI is unavailable. Choose UPI in Razorpay Checkout instead.' }, 410)
})
