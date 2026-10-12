import { corsHeaders, jsonResponse } from '../_shared/http.ts'

// Direct merchant-VPA links disclose the payee address and cannot prove that
// a transfer completed. New UPI payments must go through Razorpay Checkout,
// with captured status verified server-side. Deploy this replacement to retire
// any previously deployed version of this endpoint that returned the VPA.
Deno.serve((request: Request) => {
  // No Auth/database client is needed for this retired endpoint. Keeping the
  // preflight local also avoids bundling the unrelated Supabase SDK.
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)
  return jsonResponse({ error: 'Direct UPI is unavailable. Choose UPI in Razorpay Checkout instead.' }, 410)
})
