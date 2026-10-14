import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Card, Input, Label, Modal } from '../components/ui'
import { getPaymentsByUser, refreshPayments, type PaymentRecord } from '../data/payments'
import { getPlans, refreshPlans, type Plan } from '../data/plans'
import { TERMS_LAST_UPDATED, TERMS_SECTIONS } from '../data/terms'
import { CREATOR } from '../data/creator'
import { isSubscribed, refreshCurrentSubscription, type User } from '../data/auth'
import {
  createRazorpayOrder,
  loadRazorpayCheckout,
  openRazorpayCheckout,
  submitManualUpiUtr,
  verifyRazorpayPayment,
  type RazorpayCheckoutResponse,
} from '../data/razorpay'

export function PlansScreen({
  user,
  onSubscribed,
}: {
  user: User
  onSubscribed: (user: User) => void
}) {
  // Every plan in the server catalog stays purchasable; prices come from the
  // server, never from the browser.
  const [plans, setPlans] = useState<Plan[]>(() => getPlans())
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(
    () => plans.find((plan) => plan.id === selectedId)
      ?? plans.find((plan) => plan.popular)
      ?? plans[0],
    [plans, selectedId],
  )
  const [showTerms, setShowTerms] = useState(false)
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
  // The plan confirmed by the checkout that just finished. The server ledger
  // stays authoritative; this only covers the seconds until its read returns.
  const [purchasedPlanId, setPurchasedPlanId] = useState<string | null>(null)
  const checkoutPlanId = useRef<string | null>(null)
  const unlocked = isSubscribed(user)
  const activeUntil = user.subscribedUntil ? new Date(user.subscribedUntil).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : null

  /** Expiry date of a plan, in the same wording the Account page uses. */
  const when = (ms: number) => new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

  // Which plan each successful payment bought, with the latest expiry it
  // reached. Read from the server ledger only.
  const purchasedPlans = useMemo(() => {
    const bought = new Map<string, number>()
    payments
      .filter((payment) => payment.status === 'success')
      .forEach((payment) => {
        const at = payment.expiresAt ?? payment.createdAt
        const known = bought.get(payment.planId)
        if (known === undefined || at > known) bought.set(payment.planId, at)
      })
    return bought
  }, [payments])

  // The plan that is active now: the newest verified payment that still covers
  // the subscription (a renewal moves the active plan to the newer one).
  const activePlan = useMemo(() => {
    const paid = payments
      .filter((payment) => payment.status === 'success')
      .sort((a, b) => (b.expiresAt ?? b.createdAt) - (a.expiresAt ?? a.createdAt))
    const covering = paid.filter((payment) => (payment.expiresAt ?? 0) > Date.now())
    const chosen = covering[0] ?? paid[0]
    const planId = chosen?.planId ?? purchasedPlanId
    if (!planId) return null
    const expiresAt = Math.max(chosen?.expiresAt ?? 0, user.subscribedUntil ?? 0) || undefined
    return { planId, expiresAt }
  }, [payments, purchasedPlanId, user.subscribedUntil])

  // Show the plan the user already owns as the selected one, so its button
  // reads "Extend / Renew" instead of "Select plan".
  useEffect(() => {
    if (selectedId || !activePlan) return
    setSelectedId(activePlan.planId)
  }, [activePlan, selectedId])

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
    void refreshPlans()
      .then((loaded) => {
        setPlans(loaded.filter((plan) => plan.active))
        setCatalogError(null)
      })
      .catch((cause: unknown) => {
        setCatalogError(cause instanceof Error ? cause.message : 'The plan catalog could not be loaded.')
      })
    // Load only when the signed-in account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  // Clicking a plan only selects it (the blue ring moves there). Checkout opens
  // from the selected plan's own button, so nothing is charged by accident.
  function selectPlan(planId: string) {
    setSelectedId(planId)
  }

  function openCheckout(plan: Plan) {
    setSelectedId(plan.id)
    checkoutPlanId.current = plan.id
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
    setPurchasedPlanId(checkoutPlanId.current)
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
    <div className="max-w-3xl mx-auto px-4 pb-6 pt-4 space-y-5">
      <Card className="p-3 bg-gradient-to-br from-brand-50 to-indigo-50 border-brand-200">
        <div className="text-[10px] font-bold uppercase tracking-widest text-brand-800">Subscription</div>
        <h1 className="text-base font-extrabold text-slate-900 leading-tight">Unlock company details and apply</h1>
        <p className="text-xs text-slate-700 mt-0.5">Pay inside secure Razorpay Checkout. Access starts once the server verifies payment.</p>
        {unlocked && activeUntil && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-950 bg-emerald-100 px-2.5 py-1 rounded-full ring-1 ring-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 pulse-dot" /> Active until {activeUntil}
          </div>
        )}
      </Card>

      {catalogError && (
        <div role="alert" className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-sm font-semibold text-amber-900">
          {catalogError} Prices shown are the standard catalog; checkout always uses the live server price.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const isSelected = selected.id === plan.id
          // Marked active/purchased: the plan the server ledger says is
          // covering the subscription right now, or the one bought in this
          // session a moment ago.
          const isActive = activePlan?.planId === plan.id
          const activeExpiry = isActive ? activePlan.expiresAt : undefined
          const boughtAt = purchasedPlans.get(plan.id)
          return (
            <Card
              key={plan.id}
              onClick={() => selectPlan(plan.id)}
              className={`p-4 relative cursor-pointer transition ${isActive ? 'ring-2 ring-emerald-500 ring-offset-2 bg-gradient-to-br from-emerald-50 to-white' : isSelected ? 'ring-2 ring-brand-600 ring-offset-2 bg-gradient-to-br from-brand-50 to-indigo-50' : 'hover:ring-1 hover:ring-brand-300'} ${plan.popular && !isSelected && !isActive ? 'bg-gradient-to-br from-white to-brand-50' : ''}`}
            >
              {isActive && <div className="absolute -top-2 right-3"><Badge color="green">✓ Active</Badge></div>}
              {!isActive && isSelected && <div className="absolute -top-2 right-3"><Badge color="brand">Selected</Badge></div>}
              {!isActive && !isSelected && plan.popular && <div className="absolute -top-2 right-3"><Badge color="brand">Most popular</Badge></div>}
              {!isActive && boughtAt !== undefined && <div className="absolute -top-2 left-3"><Badge color="slate">Purchased</Badge></div>}
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
              {isActive && activeExpiry !== undefined && (
                <div className={`mt-2 text-sm font-extrabold ${activeExpiry > Date.now() ? 'text-emerald-700' : 'text-amber-800'}`}>
                  {activeExpiry > Date.now() ? `Active until ${when(activeExpiry)}` : `Expired on ${when(activeExpiry)}`}
                </div>
              )}
              {!isActive && boughtAt !== undefined && (
                <div className="mt-2 text-xs font-semibold text-slate-600">
                  {boughtAt > Date.now() ? `Purchased earlier · access till ${when(boughtAt)}` : `Purchased earlier · expired ${when(boughtAt)}`}
                </div>
              )}
              <Button
                variant={isSelected ? 'primary' : 'secondary'}
                className="w-full mt-3"
                onClick={() => (isSelected ? openCheckout(plan) : selectPlan(plan.id))}
              >
                {isSelected ? (unlocked ? 'Extend / Renew' : 'Choose plan') : 'Select plan'}
              </Button>
            </Card>
          )
        })}
      </div>

      <Card className="p-4">
        <div className="text-sm font-bold text-slate-900 mb-1">Plan benefits</div>
        <ul className="text-xs text-slate-800 space-y-1 list-disc pl-5">
          <li>Full company name, manager and contact number for every job</li>
          <li>One-tap Apply with confirmation</li>
          <li>Priority job alerts and pinned jobs</li>
          <li>AI chat help and support tickets</li>
        </ul>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <div className="text-sm font-bold text-slate-900">How payment works</div>
          <Badge color="slate">Razorpay Checkout only</Badge>
        </div>
        <p className="text-xs text-slate-700">
          Every plan is paid inside secure Razorpay Checkout, using whichever methods the merchant account has enabled —
          credit/debit cards, netbanking, and UPI apps such as PhonePe, Google Pay or Paytm, plus a Razorpay QR where
          offered. We never ask you to transfer money to a personal UPI ID or bank account, and merchant banking details
          are never shown in the app.
        </p>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-bold text-slate-900 mb-1.5">Instructions & standard terms</div>
        <div className="text-[11px] leading-relaxed text-slate-600 space-y-1">
          <p>• Pay only inside Razorpay Checkout. No other payment channel is offered.</p>
          <p>• Access starts after the payment is verified by the server (Razorpay capture confirmed before your plan unlocks).</p>
          <p>• One plan per payment. Renewals add days to your existing expiry.</p>
          <p>• Do not share your bank PIN, OTP or passwords with anyone, including support.</p>
          <p>
            • Questions about a payment? Email{' '}
            <a href={`mailto:${CREATOR.contactEmail}`} className="font-semibold text-blue-600 underline underline-offset-2">{CREATOR.contactEmail}</a>.
          </p>
          <p>
            • By continuing you agree to the MedRep Connect Pro terms and conditions.{' '}
            <button
              type="button"
              onClick={() => setShowTerms(true)}
              className="font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-800"
            >
              Click here
            </button>{' '}
            to read the full terms.
          </p>
        </div>
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
          <div role="status" className="text-center py-6 space-y-2">
            <div className="text-5xl">✅</div>
            <h2 className="text-lg font-extrabold text-slate-900">Payment verified — plan active</h2>
            <p className="text-sm text-slate-700">
              {selected.title} ({selected.days} days) is marked active on your Plans page.
            </p>
            {confirmedUntil && (
              <p className="text-base font-extrabold text-emerald-700">Active until {confirmedUntil}</p>
            )}
            <Button className="w-full mt-2" onClick={() => setShowCheckout(false)}>Done</Button>
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
                <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-950 ring-1 ring-blue-200">
                  For clarity: your bank statement may list <span className="font-bold">Bharathi Enterprises</span> as the Razorpay merchant for this <span className="font-bold">MedRep Connect Pro</span> subscription.
                </p>
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

      <Modal open={showTerms} onClose={() => setShowTerms(false)} title="Terms and conditions">
        <div className="space-y-4 text-sm text-slate-800 leading-relaxed">
          <p className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-xs font-semibold text-amber-900">
            Draft — final wording is pending owner approval. Items in [square brackets] are completed before publication.
          </p>
          <p className="text-xs text-slate-500">Last updated {TERMS_LAST_UPDATED}. These terms apply to every MedRep Connect Pro user.</p>
          {TERMS_SECTIONS.map((section, index) => (
            <section key={section.title} className="space-y-1.5">
              <h3 className="font-bold text-slate-900">{index + 1}. {section.title}</h3>
              {section.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </section>
          ))}
        </div>
        <Button className="w-full mt-5" onClick={() => setShowTerms(false)}>Close</Button>
      </Modal>
    </div>
  )
}
