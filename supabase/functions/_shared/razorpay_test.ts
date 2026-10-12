import { captureRazorpayPayment, createRazorpayOrder, fetchRazorpayPayment, razorpayCredentials } from './razorpay.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const input = {
  amountPaise: 4900,
  currency: 'INR' as const,
  receipt: 'mrc_test_receipt',
  notes: { plan_id: 'p5' },
}

async function withMockGateway(
  response: Response,
  test: (calls: { url: string; options: RequestInit }[], logs: unknown[][]) => Promise<void>,
) {
  const previousId = Deno.env.get('RAZORPAY_KEY_ID')
  const previousSecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  const originalFetch = globalThis.fetch
  const originalError = console.error
  const calls: { url: string; options: RequestInit }[] = []
  const logs: unknown[][] = []
  try {
    Deno.env.set('RAZORPAY_KEY_ID', 'rzp_test_example')
    Deno.env.set('RAZORPAY_KEY_SECRET', 'private_test_value')
    globalThis.fetch = (url, options) => {
      calls.push({ url: String(url), options: options ?? {} })
      return Promise.resolve(response)
    }
    console.error = (...args: unknown[]) => { logs.push(args) }
    await test(calls, logs)
  } finally {
    globalThis.fetch = originalFetch
    console.error = originalError
    if (previousId === undefined) Deno.env.delete('RAZORPAY_KEY_ID')
    else Deno.env.set('RAZORPAY_KEY_ID', previousId)
    if (previousSecret === undefined) Deno.env.delete('RAZORPAY_KEY_SECRET')
    else Deno.env.set('RAZORPAY_KEY_SECRET', previousSecret)
  }
}

Deno.test('order request uses the Razorpay amount field in paise', async () => {
  await withMockGateway(
    Response.json({ id: 'order_test', amount: 4900, currency: 'INR', status: 'created' }),
    async (calls, logs) => {
      const order = await createRazorpayOrder(input)
      assert(order.id === 'order_test', 'expected an order ID')
      assert(calls.length === 1, 'expected one gateway request')
      assert(calls[0].url === 'https://api.razorpay.com/v1/orders', 'wrong gateway endpoint')
      assert(calls[0].options.method === 'POST', 'wrong gateway method')
      assert(
        calls[0].options.headers && 'Authorization' in calls[0].options.headers,
        'missing server authorization header',
      )
      const body = JSON.parse(String(calls[0].options.body)) as Record<string, unknown>
      assert(JSON.stringify(body) === JSON.stringify({
        amount: 4900,
        currency: 'INR',
        receipt: 'mrc_test_receipt',
        notes: { plan_id: 'p5' },
      }), 'gateway payload must use amount, not amountPaise')
      assert(logs.length === 0, 'successful request should not log a gateway error')
    },
  )
})

Deno.test('gateway failure logs status and code, not descriptions or credentials', async () => {
  await withMockGateway(
    Response.json({ error: {
      code: 'BAD_REQUEST_ERROR',
      description: 'sensitive gateway details',
      metadata: { secret: 'private_test_value' },
    } }, { status: 400 }),
    async (_calls, logs) => {
      let message = ''
      try { await createRazorpayOrder(input) } catch (error) {
        message = error instanceof Error ? error.message : ''
      }
      assert(message.includes('could not create'), 'expected generic client-facing error')
      assert(logs.length === 1, 'expected one sanitized diagnostic')
      assert(JSON.stringify(logs[0]) === JSON.stringify([
        'Razorpay order request failed:', { httpStatus: 400, errorCode: 'BAD_REQUEST_ERROR' },
      ]), 'expected only status and code in gateway log')
    },
  )
})

Deno.test('unsafe gateway error code is not logged', async () => {
  await withMockGateway(
    Response.json({ error: { code: 'secret: private_test_value' } }, { status: 401 }),
    async (_calls, logs) => {
      try { await createRazorpayOrder(input) } catch { /* expected */ }
      assert(JSON.stringify(logs[0]) === JSON.stringify([
        'Razorpay order request failed:', { httpStatus: 401, errorCode: 'unavailable' },
      ]), 'unexpected gateway code must be redacted')
    },
  )
})

Deno.test('payment fetch failure logs only status and code', async () => {
  await withMockGateway(
    Response.json({ error: { code: 'BAD_REQUEST_ERROR', description: 'private gateway text' } }, { status: 400 }),
    async (calls, logs) => {
      let message = ''
      try { await fetchRazorpayPayment('pay_test') } catch (error) {
        message = error instanceof Error ? error.message : ''
      }
      assert(message.includes('could not confirm'), 'expected generic client-facing error')
      assert(calls[0].url === 'https://api.razorpay.com/v1/payments/pay_test', 'wrong payment endpoint')
      assert(JSON.stringify(logs[0]) === JSON.stringify([
        'Razorpay payment fetch failed:', { httpStatus: 400, errorCode: 'BAD_REQUEST_ERROR' },
      ]), 'payment fetch must log only status and code')
    },
  )
})

Deno.test('capture failure logs only status and code', async () => {
  await withMockGateway(
    Response.json({ error: { code: 'SERVER_ERROR', description: 'must never be logged' } }, { status: 500 }),
    async (calls, logs) => {
      let message = ''
      try { await captureRazorpayPayment('pay_test', 4900) } catch (error) {
        message = error instanceof Error ? error.message : ''
      }
      assert(message.includes('capture is still pending'), 'expected generic client-facing error')
      assert(calls[0].url === 'https://api.razorpay.com/v1/payments/pay_test/capture', 'wrong capture endpoint')
      assert(JSON.stringify(JSON.parse(String(calls[0].options.body))) === JSON.stringify({ amount: 4900, currency: 'INR' }), 'capture must send amount in paise')
      assert(JSON.stringify(logs[0]) === JSON.stringify([
        'Razorpay capture request failed:', { httpStatus: 500, errorCode: 'SERVER_ERROR' },
      ]), 'capture must log only status and code')
    },
  )
})

Deno.test('both server credentials must be configured explicitly', () => {
  const previousId = Deno.env.get('RAZORPAY_KEY_ID')
  const previousSecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  try {
    Deno.env.delete('RAZORPAY_KEY_ID')
    Deno.env.set('RAZORPAY_KEY_SECRET', 'private_test_value')
    let rejected = false
    try { razorpayCredentials() } catch { rejected = true }
    assert(rejected, 'missing key ID must not fall back to a live ID')
  } finally {
    if (previousId === undefined) Deno.env.delete('RAZORPAY_KEY_ID')
    else Deno.env.set('RAZORPAY_KEY_ID', previousId)
    if (previousSecret === undefined) Deno.env.delete('RAZORPAY_KEY_SECRET')
    else Deno.env.set('RAZORPAY_KEY_SECRET', previousSecret)
  }
})
