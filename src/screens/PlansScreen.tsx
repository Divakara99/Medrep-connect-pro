import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Input, Label, Modal } from '../components/ui'
import { getPaymentsByUser, refreshPayments, type PaymentRecord } from '../data/payments'
import { getPlans, type Plan } from '../data/plans'
import { isSubscribed, refreshCurrentSubscription, type User } from '../data/auth'
import {
  createManualUpiIntent,
  createRazorpayOrder,
  loadRazorpayCheckout,
  openRazorpayCheckout,
  submitManualUpiUtr,
  verifyRazorpayPayment,
  type ManualUpiIntent,
  type RazorpayCheckoutResponse,
} from '../data/razorpay'

export function PlansScreen({
  user,
  onSubscribed,
}: {
  user: User
  onSubscribed: (user: User) => void
}) {
  const plans = useMemo(() => getPlans(), [])
  const [selected, setSelected] = useState<Plan>(plans.find((plan) => plan.popular) ?? plans[0])
  const [showCheckout, setShowCheckout] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [verificationPending, setVerificationPending] = useState(false)
  const [pendingCheckout, setPendingCheckout] = useState<RazorpayCheckoutResponse | null>(null)
  const [manualIntent, setManualIntent] = useState<ManualUpiIntent | null>(null)
  const [manualPaid, setManualPaid] = useState(false)
  const [utr, setUtr] = useState('')
  const [manualSubmitted, setManualSubmitted] = useState(false)
  const [payments, setPayments] = useState<PaymentRecord[]>(() => getPaymentsByUser(user.id))
  const unlocked = isSubscribed(user)
  const activeUntil = user.subscribedUntil ? new Date(user.subscribedUntil).toLocaleDateString() : null

  async function loadPaymentHistory() {
    try {
      const serverPayments = await refreshPayments()
      setPayments(serverPayments.filter((payment) => payment.userId === user.id))
    } catch {
      // Checkout reports setup problems when attempted. Keep sign-in and the
      // rest of the app available if the billing migration has not been run.
      setPayments(getPaymentsByUser(user.id))
    }
  }

  useEffect(() => {
    void loadPaymentHistory()
    // Load only when the signed-in account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  function openCheckout(plan: Plan) {
    setSelected(plan)
    setError(null)
    setSuccess(false)
    setVerificationPending(false)
    setPendingCheckout(null)
    setManualIntent(null)
    setManualPaid(false)
    setUtr('')
    setManualSubmitted(false)
    setShowCheckout(true)
  }

  async function activateFromServer(expiresAt: string) {
    const refreshedUser = await refreshCurrentSubscription()
    const serverExpiry = new Date(expiresAt).getTime()
    const updatedUser = refreshedUser
      ? { ...refreshedUser, subscribedUntil: Math.max(refreshedUser.subscribedUntil ?? 0, serverExpiry) }
      : { ...user, subscribedUntil: serverExpiry }
    onSubscribed(updatedUser)
    await loadPaymentHistory()
    setSuccess(true)
    setError(null)
    setVerificationPending(false)
    setPendingCheckout(null)
  }

  async function verifyPayment(response: RazorpayCheckoutResponse) {
    setPendingCheckout(response)
    setProcessing(true)
    setError(null)
    try {
      const result = await verifyRazorpayPayment(response)
      if (result.activated && result.expiresAt) {
        await activateFromServer(result.expiresAt)
      } else {
        setVerificationPending(true)
        setError(result.message || 'Razorpay is still confirming the payment. Your plan remains locked until confirmation.')
      }
    } catch (verifyError) {
      setVerificationPending(true)
      setError(verifyError instanceof Error
        ? `Payment was returned by Razorpay, but server verification is still pending. Do not pay again. You can check again shortly. ${verifyError.message}`
        : 'Payment verification is pending. Do not pay again; check the payment status shortly.')
    } finally {
      setProcessing(false)
    }
  }

  async function startRazorpayCheckout() {
    setProcessing(true)
    setError(null)
    setVerificationPending(false)
    try {
      await loadRazorpayCheckout()
      const order = await createRazorpayOrder(selected.id)
      const checkout = openRazorpayCheckout({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'MedRep Connect Pro',
        description: `${order.planTitle} · ${order.planDays} days`,
        order_id: order.orderId,
        prefill: { name: user.name, email: user.email },
        theme: { color: '#1746bb' },
        method: { upi: true, card: true, netbanking: true, wallet: false },
        handler: (response) => { void verifyPayment(response) },
        modal: {
          ondismiss: () => setProcessing(false),
        },
      })
      checkout.on('payment.failed', (response) => {
        setProcessing(false)
        setError(response.error?.description || 'Payment was not completed. No plan was activated.')
      })
      checkout.open()
    } catch (checkoutError) {
      setProcessing(false)
      setError(checkoutError instanceof Error ? checkoutError.message : 'Could not start Razorpay checkout.')
    }
  }

  async function checkPaymentStatus() {
    if (!pendingCheckout) return
    await verifyPayment(pendingCheckout)
  }

  async function startManualUpi() {
    setProcessing(true)
    setError(null)
    try {
      const intent = await createManualUpiIntent(selected.id)
      setManualIntent(intent)
      setManualPaid(false)
      setUtr('')
      setManualSubmitted(false)
    } catch (upiError) {
      setError(upiError instanceof Error ? upiError.message : 'Could not start a UPI request.')
    } finally {
      setProcessing(false)
    }
  }

  async function submitUtr() {
    if (!manualIntent) return
    setProcessing(true)
    setError(null)
    try {
      await submitManualUpiUtr(manualIntent.paymentRecordId, utr.trim())
      setManualSubmitted(true)
      await loadPaymentHistory()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit the UPI reference.')
    } finally {
      setProcessing(false)
    }
  }

  const paymentRows = payments.length > 0 ? payments : getPaymentsByUser(user.id)

  return (
    <div className="max-w-3xl mx-auto px-4 pb-28 pt-4 space-y-5">
      <Card className="p-5 bg-gradient-to-br from-brand-50 to-indigo-50 border-brand-200">
        <div className="text-xs font-bold uppercase tracking-widest text-brand-800">Subscription</div>
        <h1 className="text-xl font-extrabold text-slate-900 mt-1">Unlock company details and apply</h1>
        <p className="text-sm text-slate-800 mt-1">
          Choose a plan. Razorpay supports UPI, cards and netbanking; direct UPI is verified by an admin before activation.
        </p>
        {unlocked && activeUntil && (
          <div className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-emerald-950 bg-emerald-100 px-3 py-1.5 rounded-full ring-1 ring-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-600 pulse-dot" /> Active until {activeUntil}
          </div>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const isSelected = selected.id === plan.id
          return (
            <Card key={plan.id} className={`p-4 relative ${isSelected ? 'ring-2 ring-brand-600' : ''} ${plan.popular ? 'bg-gradient-to-br from-white to-brand-50' : ''}`}>
              {plan.popular && <div className="absolute -top-2 right-3"><Badge color="brand">Most popular</Badge></div>}
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-slate-900">{plan.title}</div>
                <div className="text-2xl font-extrabold text-brand-800">₹{plan.price}</div>
              </div>
              <div className="text-sm font-semibold text-slate-700 mt-0.5">
                {plan.days >= 365
                  ? `${Math.round(plan.days / 365)} year`
                  : plan.days >= 30
                    ? `${Math.round(plan.days / 30)} month${plan.days >= 60 ? 's' : ''}`
                    : `${plan.days} days`}
              </div>
              <div className="text-sm text-slate-800 mt-2">{plan.tagline}</div>
              <Button variant={isSelected ? 'primary' : 'secondary'} className="w-full mt-3" onClick={() => openCheckout(plan)}>
                {unlocked ? 'Extend / Renew' : 'Choose plan'}
              </Button>
            </Card>
          )
        })}
      </div>

      <Card className="p-4">
        <div className="text-sm font-bold text-slate-900 mb-1">Plan benefits</div>
        <ul className="text-sm text-slate-800 space-y-1 list-disc pl-5">
          <li>Full company name, manager and contact number for every job</li>
          <li>One-tap Apply with confirmation</li>
          <li>Priority job alerts and pinned jobs</li>
          <li>AI chat help and support tickets</li>
        </ul>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="text-sm font-bold text-slate-900">Payment history</div>
          <Badge color="slate">{paymentRows.length} records</Badge>
        </div>
        {paymentRows.length === 0 ? (
          <div className="text-sm text-slate-700">No payments yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[480px]">
              <thead className="text-slate-700 text-left">
                <tr>
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Plan</th>
                  <th className="py-1 pr-2">Reference</th>
                  <th className="py-1 pr-2">UTR</th>
                  <th className="py-1 pr-2">Amount</th>
                  <th className="py-1 pr-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.map((payment) => (
                  <tr key={payment.id} className="border-t border-slate-200">
                    <td className="py-2 pr-2 text-slate-700">{new Date(payment.createdAt).toLocaleDateString()}</td>
                    <td className="py-2 pr-2 font-semibold text-slate-900">{payment.planTitle ?? payment.planId}</td>
                    <td className="py-2 pr-2 font-mono text-slate-800">{payment.gatewayPaymentId ?? payment.txRef ?? '—'}</td>
                    <td className="py-2 pr-2 font-mono text-slate-800">{payment.utr || '—'}</td>
                    <td className="py-2 pr-2 font-bold text-slate-900">₹{payment.amount}</td>
                    <td className="py-2 pr-2">
                      <Badge color={payment.status === 'success' ? 'green' : payment.status === 'pending' ? 'amber' : 'red'}>
                        {payment.manualReview ? 'Awaiting UPI verification' : payment.status === 'success' ? 'Paid' : payment.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showCheckout} onClose={() => { if (!processing) setShowCheckout(false) }} title="Confirm your plan">
        {success ? (
          <div role="status" className="text-center py-8">
            <div className="text-5xl mb-3">✅</div>
            <h2 className="text-lg font-extrabold text-slate-900">Payment verified</h2>
            <p className="text-sm text-slate-700 mt-1">Your {selected.days}-day plan is active. {user.subscribedUntil ? `Active until ${new Date(user.subscribedUntil).toLocaleDateString()}.` : ''}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-indigo-50 p-4 ring-1 ring-indigo-200 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-900">{selected.title}</div>
                <div className="text-sm font-semibold text-slate-700">{selected.days} days of access</div>
              </div>
              <div className="text-2xl font-extrabold text-indigo-900">₹{selected.price}</div>
            </div>

            {!manualIntent && !verificationPending && (
              <>
                <Button className="w-full" onClick={() => { void startRazorpayCheckout() }} disabled={processing}>
                  {processing ? 'Opening secure checkout…' : `Pay ₹${selected.price} with Razorpay`}
                </Button>
                <div className="text-center text-xs font-semibold text-slate-600">UPI, card or netbanking</div>
                <button
                  type="button"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => { void startManualUpi() }}
                  disabled={processing}
                >
                  {processing ? 'Preparing UPI…' : 'Pay directly by UPI'}
                </button>
              </>
            )}

            {verificationPending && (
              <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-300">
                <p className="text-sm font-bold text-amber-950">Payment confirmation is pending</p>
                <p className="text-sm text-amber-900 mt-1">Do not make another payment. The plan stays locked until Razorpay confirms capture.</p>
                {pendingCheckout && (
                  <p className="mt-2 text-xs font-mono text-amber-900 break-all">Payment ID: {pendingCheckout.razorpay_payment_id}</p>
                )}
                <Button variant="secondary" className="w-full mt-3" onClick={() => { void checkPaymentStatus() }} disabled={processing}>
                  {processing ? 'Checking…' : 'Check payment status'}
                </Button>
              </div>
            )}

            {manualIntent && (
              <div className="space-y-3">
                <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-300">
                  <p className="text-sm font-bold text-emerald-950">Pay ₹{manualIntent.amountRupees} to this UPI ID</p>
                  <p className="text-base font-extrabold text-emerald-950 mt-1 select-all">{manualIntent.vpa}</p>
                  <p className="text-xs text-emerald-900 mt-1">Use reference {manualIntent.upiReference} in your UPI app if it asks for one.</p>
                  <a
                    href={manualIntent.upiUri}
                    className="mt-3 inline-flex w-full justify-center rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800"
                  >
                    Open UPI app
                  </a>
                </div>

                {manualSubmitted ? (
                  <div role="status" className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-950 ring-1 ring-amber-300">
                    UTR submitted. Your plan will activate only after an admin verifies the payment in the bank account.
                  </div>
                ) : !manualPaid ? (
                  <div className="space-y-2">
                    <p className="text-sm text-slate-800">Complete the payment in your UPI app, then return here. The UTR field appears after you confirm the transfer.</p>
                    <Button variant="secondary" className="w-full" onClick={() => setManualPaid(true)}>
                      I completed the payment — enter UTR
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="upi-utr">UTR / transaction ID from your completed payment</Label>
                    <Input
                      id="upi-utr"
                      value={utr}
                      onChange={(event) => setUtr(event.target.value.replace(/\s/g, '').slice(0, 35))}
                      placeholder="Find this in your UPI app's payment details"
                      autoComplete="off"
                      inputMode="text"
                      maxLength={35}
                    />
                    <p className="text-xs text-slate-700">The UTR is generated by your bank after payment. A typed reference alone does not activate a plan.</p>
                    <Button className="w-full" onClick={() => { void submitUtr() }} disabled={processing || utr.trim().length < 6}>
                      {processing ? 'Submitting…' : 'Submit UTR for verification'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {error && <div role="alert" className="rounded-lg bg-red-50 text-red-900 text-sm font-medium px-3 py-2 ring-1 ring-red-300">{error}</div>}
            <p className="text-xs text-slate-700">Your plan activates only after Razorpay confirms a captured payment. Direct UPI requests wait for manual bank verification.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
