import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Input, Label, Modal } from '../components/ui'
import { getPaymentsByUser, refreshPayments, type PaymentRecord } from '../data/payments'
import { getPlans, type Plan } from '../data/plans'
import { getAltPaymentDetails, hasAltPaymentDetails } from '../data/altPayment'
import { isSubscribed, refreshCurrentSubscription, type User } from '../data/auth'
import {
  createRazorpayOrder,
  loadRazorpayCheckout,
  openRazorpayCheckout,
  submitManualUpiUtr,
  verifyRazorpayPayment,
  type RazorpayCheckoutResponse,
} from '../data/razorpay'

/** Plan selection is intentionally locked to the 15-day plan. */
const LOCKED_PLAN_ID = 'p15'

export function PlansScreen({
  user,
  onSubscribed,
}: {
  user: User
  onSubscribed: (user: User) => void
}) {
  const plans = useMemo(() => getPlans(), [])
  // Selection is fixed to the 15-day plan (blue). Clicking other plans never
  // shifts the selection — they are not purchasable right now.
  const selected = useMemo(
    () => plans.find((plan) => plan.id === LOCKED_PLAN_ID) ?? plans.find((plan) => plan.popular) ?? plans[0],
    [plans],
  )
  const [planNotice, setPlanNotice] = useState<string | null>(null)
  const [showTerms, setShowTerms] = useState(false)
  const altPayment = useMemo(() => getAltPaymentDetails(), [])
  const [showCheckout, setShowCheckout] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [confirmedUntil, setConfirmedUntil] = useState<string | null>(null)
  const [verificationPending, setVerificationPending] = useState(false)
  const [autoChecks, setAutoChecks] = useState(0)
  const [pendingCheckout, setPendingCheckout] = useState<RazorpayCheckoutResponse | null>(null)
  const [legacyPaymentId, setLegacyPaymentId] = useState<string | null>(null)
  const [legacyUtr, setLegacyUtr] = useState('')
  const [legacyError, setLegacyError] = useState<string | null>(null)
  const [legacySubmitting, setLegacySubmitting] = useState(false)
  const [payments, setPayments] = useState<PaymentRecord[]>(() => getPaymentsByUser(user.id))
  const unlocked = isSubscribed(user)
  const activeUntil = user.subscribedUntil ? new Date(user.subscribedUntil).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : null

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
    if (plan.id !== selected.id) {
      // Clicking any other plan must not move the locked blue selection.
      setPlanNotice('Only the 15-day plan can be purchased right now — the blue selection stays locked to it.')
      return
    }
    setPlanNotice(null)
    setError(null)
    setSuccess(false)
    setConfirmedUntil(null)
    setVerificationPending(false)
    setAutoChecks(0)
    setPendingCheckout(null)
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
    setConfirmedUntil(new Date(updatedUser.subscribedUntil ?? serverExpiry).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))
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
        // Razorpay decides which enabled methods, UPI apps and QR options are available.
        handler: (response) => { void verifyPayment(response) },
        modal: {
          ondismiss: () => setProcessing(false),
        },
      })
      checkout.on('payment.failed', () => {
        setProcessing(false)
        setError('Payment was not completed. If you were charged, do not pay again; contact support with your payment ID.')
      })
      checkout.open()
    } catch (checkoutError) {
      setProcessing(false)
      setError(checkoutError instanceof Error ? checkoutError.message : 'Could not start Razorpay checkout.')
    }
  }

  // Capture/webhooks may take a few seconds. Retry verification with the same
  // Razorpay response; never create a second order or ask for another payment.
  useEffect(() => {
    if (!showCheckout || !verificationPending || !pendingCheckout || processing || autoChecks >= 3) return
    const timer = window.setTimeout(() => {
      setAutoChecks((count) => count + 1)
      void verifyPayment(pendingCheckout)
    }, 12_000)
    return () => window.clearTimeout(timer)
    // Retrying depends only on the pending state; verifyPayment is local to this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCheckout, verificationPending, pendingCheckout, processing, autoChecks])

  async function checkPaymentStatus() {
    if (!pendingCheckout) return
    await verifyPayment(pendingCheckout)
  }

  async function submitLegacyUtr() {
    if (!legacyPaymentId || legacySubmitting) return
    setLegacySubmitting(true)
    setLegacyError(null)
    try {
      await submitManualUpiUtr(legacyPaymentId, legacyUtr.trim())
      await loadPaymentHistory()
      setLegacyPaymentId(null)
      setLegacyUtr('')
    } catch (submissionError) {
      setLegacyError(submissionError instanceof Error ? submissionError.message : 'Could not submit the reference.')
    } finally { setLegacySubmitting(false) }
  }

  const paymentRows = payments.length > 0 ? payments : getPaymentsByUser(user.id)

  return (
    <div className="max-w-3xl mx-auto px-4 pb-28 pt-4 space-y-5">
      <Card className="p-5 bg-gradient-to-br from-brand-50 to-indigo-50 border-brand-200">
        <div className="text-xs font-bold uppercase tracking-widest text-brand-800">Subscription</div>
        <h1 className="text-xl font-extrabold text-slate-900 mt-1">Unlock company details and apply</h1>
        <p className="text-sm text-slate-800 mt-1">
          Choose a plan and pay inside secure Razorpay Checkout. Use a credit/debit card or an available UPI app/QR option. We never ask you to send money to a UPI ID.
        </p>
        {unlocked && activeUntil && (
          <div className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-emerald-950 bg-emerald-100 px-3 py-1.5 rounded-full ring-1 ring-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-600 pulse-dot" /> Active until {activeUntil}
          </div>
        )}
      </Card>

      {planNotice && (
        <div role="status" className="rounded-xl bg-brand-50 ring-1 ring-brand-200 px-3 py-2 text-sm font-semibold text-brand-900">
          {planNotice}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const isSelected = selected.id === plan.id
          return (
            <Card key={plan.id} className={`p-4 relative ${isSelected ? 'ring-2 ring-brand-600 ring-offset-2 bg-gradient-to-br from-brand-50 to-indigo-50' : ''} ${plan.popular && !isSelected ? 'bg-gradient-to-br from-white to-brand-50' : ''}`}>
              {isSelected && <div className="absolute -top-2 right-3"><Badge color="brand">Selected · 15-day plan</Badge></div>}
              {!isSelected && plan.popular && <div className="absolute -top-2 right-3"><Badge color="brand">Most popular</Badge></div>}
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
              <Button
                variant={isSelected ? 'primary' : 'secondary'}
                className="w-full mt-3"
                onClick={() => openCheckout(plan)}
              >
                {isSelected ? (unlocked ? 'Extend / Renew' : 'Choose plan') : 'Unavailable for now'}
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
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <div className="text-sm font-bold text-slate-900">Alternative payment details</div>
          <Badge color="slate">Optional · manual verification</Badge>
        </div>
        {hasAltPaymentDetails() ? (
          <div className="text-sm text-slate-800 space-y-1.5">
            {altPayment.upiId.trim() && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">UPI ID:</span>
                <span className="font-mono bg-slate-100 rounded-lg px-2 py-1 select-all">{altPayment.upiId.trim()}</span>
              </div>
            )}
            {altPayment.bankDetails.trim() && (
              <div>
                <span className="font-semibold">Bank transfer:</span>
                <div className="whitespace-pre-wrap text-slate-700 mt-0.5">{altPayment.bankDetails.trim()}</div>
              </div>
            )}
            {altPayment.instructions.trim() && (
              <div className="text-xs text-slate-600">{altPayment.instructions.trim()}</div>
            )}
            <div className="text-xs font-semibold text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-lg px-2.5 py-2">
              After paying through any alternative option, submit your bank UTR from Payment history below.
              An admin verifies the bank credit before access activates. Never share your PIN or OTP with anyone.
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-600">
            No alternative payment options are configured. Razorpay Checkout (cards, UPI apps, QR) is the default secure path.
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="text-sm font-bold text-slate-900 mb-1.5">Instructions & standard terms</div>
        <div className="text-[11px] leading-relaxed text-slate-600 space-y-1">
          <p>• Pay only inside Razorpay Checkout or through the alternative payment details shown above.</p>
          <p>• Access starts after the payment is verified (instant for Razorpay; manual admin verification for alternative payments).</p>
          <p>• One plan per payment. Renewals add days to your existing expiry.</p>
          <p>• Do not share your bank PIN, OTP or passwords with anyone, including support.</p>
          <p>• By continuing you agree to the standard MedRep Connect Pro terms and conditions.</p>
        </div>
        <Button variant="secondary" className="mt-2.5 px-3.5 py-2 text-xs font-bold" onClick={() => setShowTerms(true)}>
          Click Here
        </Button>
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

      {paymentRows.some((payment) => payment.paymentMethod === 'UPI' && payment.status === 'pending' && !payment.manualReview) && (
        <Card className="p-4 space-y-2">
          <h2 className="font-bold text-slate-900">Earlier direct UPI transfer?</h2>
          <p className="text-sm text-slate-700">Only if you already paid for an existing manual UPI request, select its reference and enter the bank-generated UTR. Do not make a new direct transfer. An admin must verify the bank credit before access activates.</p>
          <Label htmlFor="legacy-upi-order">Existing request</Label>
          <select id="legacy-upi-order" className="w-full rounded-lg border border-slate-300 p-2" value={legacyPaymentId ?? ''} onChange={(event) => { setLegacyPaymentId(event.target.value || null); setLegacyError(null) }}>
            <option value="">Select an existing request</option>
            {paymentRows.filter((payment) => payment.paymentMethod === 'UPI' && payment.status === 'pending' && !payment.manualReview).map((payment) => (
              <option value={payment.id} key={payment.id}>{payment.txRef} · ₹{payment.amount}</option>
            ))}
          </select>
          <Label htmlFor="legacy-upi-utr">UTR from your completed bank transfer</Label>
          <Input id="legacy-upi-utr" value={legacyUtr} onChange={(event) => setLegacyUtr(event.target.value.replace(/\s/g, '').slice(0, 35))} maxLength={35} autoComplete="off" />
          {legacyError && <p role="alert" className="text-sm text-red-800">{legacyError}</p>}
          <Button disabled={!legacyPaymentId || legacyUtr.trim().length < 6 || legacySubmitting} onClick={() => { void submitLegacyUtr() }}>
            {legacySubmitting ? 'Submitting…' : 'Submit old UTR for bank verification'}
          </Button>
        </Card>
      )}

      <Modal open={showCheckout} onClose={() => { if (!processing) setShowCheckout(false) }} title="Confirm your plan">
        {success ? (
          <div role="status" className="text-center py-8">
            <div className="text-5xl mb-3">✅</div>
            <h2 className="text-lg font-extrabold text-slate-900">Payment verified</h2>
            <p className="text-sm text-slate-700 mt-1">Your {selected.days}-day plan is active. {confirmedUntil ? `Active until ${confirmedUntil}.` : ''}</p>
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

            {!verificationPending && (
              <>
                <Button className="w-full" onClick={() => { void startRazorpayCheckout() }} disabled={processing}>
                  {processing ? 'Opening secure checkout…' : `Pay ₹${selected.price} with Razorpay`}
                </Button>
                <p className="text-xs text-slate-700 text-center">Cards (credit/debit), netbanking and UPI apps such as PhonePe or Google Pay are shown if enabled by Razorpay. On supported devices, choose UPI to scan a Razorpay QR if offered.</p>
              </>
            )}

            {verificationPending && (
              <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-300">
                <p className="text-sm font-bold text-amber-950">Payment confirmation is pending</p>
                <p className="text-sm text-amber-900 mt-1">Do not make another payment. We will check again automatically; the plan stays locked until Razorpay confirms capture.</p>
                {pendingCheckout && (
                  <p className="mt-2 text-xs font-mono text-amber-900 break-all">Payment ID: {pendingCheckout.razorpay_payment_id}</p>
                )}
                <Button variant="secondary" className="w-full mt-3" onClick={() => { void checkPaymentStatus() }} disabled={processing}>
                  {processing ? 'Checking…' : 'Check payment status'}
                </Button>
              </div>
            )}

            {error && <div role="alert" className="rounded-lg bg-red-50 text-red-900 text-sm font-medium px-3 py-2 ring-1 ring-red-300">{error}</div>}
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-800 space-y-1">
              <p>1. Check the plan and amount, then open Razorpay Checkout.</p>
              <p>2. In Razorpay choose a card, or UPI → PhonePe, Google Pay, another available app, or QR if offered. Approve payment only inside your bank/UPI app; never share your PIN or OTP here.</p>
              <p>3. Return here and wait for server confirmation. If charged but not activated, do not pay again; use Check payment status or contact support with the payment ID.</p>
              <p>Access begins after verified capture. Renewals add {selected.days} days to your existing expiry (or start now if expired).</p>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={showTerms} onClose={() => setShowTerms(false)} title="Standard terms and conditions">
        <div className="space-y-3 text-sm text-slate-800 leading-relaxed">
          <p><span className="font-bold">1. Platform role.</span> MedRep Connect Pro is a job-listing and subscription platform for pharma and multi-industry field roles. We list vacancies in good faith; hiring decisions rest with the employing companies and their managers.</p>
          <p><span className="font-bold">2. Subscriptions.</span> Plans unlock company names, manager contacts and one-tap apply for the purchased period. Plan validity and amounts are fixed by the server-side catalog shown at checkout.</p>
          <p><span className="font-bold">3. Payments.</span> Online payments run through Razorpay Checkout. Alternative payment options (manual UPI/bank transfer), when offered, are verified manually by an admin against the merchant bank statement before access activates.</p>
          <p><span className="font-bold">4. Refunds.</span> If a payment was captured but access could not be activated, contact support with the payment ID/UTR. Verified duplicate or failed captures are reviewed and refunded to the source account.</p>
          <p><span className="font-bold">5. Accounts.</span> Keep your profile and resume accurate. Applications sent through the platform are shared with the hiring manager of that vacancy. Do not share your account password, bank PIN or OTP with anyone.</p>
          <p><span className="font-bold">6. Acceptable use.</span> Do not scrape listings, redistribute confidential vacancy details, or misuse manager contacts. Accounts abusing the service may be suspended.</p>
          <p className="text-xs text-slate-500">These standard terms apply to all MedRep Connect Pro users. For questions, raise a support ticket from the AI Help / Account screens.</p>
        </div>
        <Button className="w-full mt-4" onClick={() => setShowTerms(false)}>Close</Button>
      </Modal>
    </div>
  )
}
