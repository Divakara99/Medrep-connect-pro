import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Card, Input, Label, Modal } from '../components/ui'
import { getPaymentsByUser, refreshPayments, type PaymentRecord } from '../data/payments'
import { getPlans, refreshPlans, type Plan } from '../data/plans'
import { readPlanState } from '../data/planState'
import { accessLabel, daysLabel, paymentDayLabel, paymentDayStart, paymentStatusLabel, periodLabel, planTitle } from '../data/planDisplay'
import { isSubscribed, refreshCurrentSubscription, type User } from '../data/auth'
import {
  createRazorpayOrder,
  loadRazorpayCheckout,
  openRazorpayCheckout,
  submitManualUpiUtr,
  verifyRazorpayPayment,
  type RazorpayCheckoutResponse,
} from '../data/razorpay'
import { isAndroidApp } from '../data/platform'
import { TermsPage } from './TermsPage'
import { PlanInfoPage } from './PlanInfoPage'
import { buyPlanWithGooglePlay, loadPlayPrices, restorePlayPurchases } from '../data/playBilling'


/** One labelled line inside a receipt. */
function ReceiptField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`break-words font-semibold text-slate-900 ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value}</dd>
    </div>
  )
}

export function PlansScreen({
  user,
  onSubscribed,
}: {
  user: User
  onSubscribed: (user: User) => void
}) {
  // Every plan in the server catalog stays purchasable; prices come from the
  // server, never from the browser.
  // Inside the Android app, payment is Google Play Billing ONLY: Razorpay,
  // UPI and every mention of paying on the website are hidden. On the website
  // this is always false and the Razorpay flow renders exactly as before.
  const inApp = isAndroidApp()
  const [playPrices, setPlayPrices] = useState<Map<string, string>>(new Map())
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
  // The three reading cards live on their own page; the passes page is for choosing.
  const [showInfo, setShowInfo] = useState(false)
  // The one payment whose receipt is open over the page.
  const [historyPayment, setHistoryPayment] = useState<PaymentRecord | null>(null)
  const [showCheckout, setShowCheckout] = useState(false)
  // Tapped × / backdrop / phone-back while a payment was still running: ask
  // instead of doing nothing, so the sheet can never become unclosable.
  const [closeAsk, setCloseAsk] = useState(false)
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

  // Active vs expired is decided by planState.ts, which the test suite pins:
  // a pass whose days have run out is never labelled Active, because the
  // contact details it unlocked are locked again at that same moment.
  const planState = useMemo(
    () => readPlanState(payments, {
      unlocked,
      purchasedPlanId,
      subscribedUntil: user.subscribedUntil,
    }),
    [payments, unlocked, purchasedPlanId, user.subscribedUntil],
  )
  const purchasedPlans = planState.purchased
  const activePlanId = planState.activePlanId
  const activePlan = activePlanId ? { planId: activePlanId, expiresAt: planState.activeUntil } : null
  const expiredPlan = planState.expiredPlanId
    ? { planId: planState.expiredPlanId, expiresAt: planState.expiredAt }
    : null

  // Show the plan the user already owns as the selected one — the active pass,
  // or the one that just ran out, so renewing it is one tap — so the button
  // reads "Extend / Renew" instead of "Select plan".
  useEffect(() => {
    if (selectedId || !planState.suggestedPlanId) return
    setSelectedId(planState.suggestedPlanId)
  }, [planState.suggestedPlanId, selectedId])

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
      .then(async (loaded) => {
        const active = loaded.filter((plan) => plan.active)
        setPlans(active)
        setCatalogError(null)
        if (inApp) {
          // Localised Play prices, and finish any purchase Play still holds
          // (e.g. the app was closed while payment completed).
          setPlayPrices(await loadPlayPrices(active))
          const restored = await restorePlayPurchases(active)
          if (restored.restored > 0) {
            const refreshed = await refreshCurrentSubscription()
            if (refreshed) onSubscribed(refreshed)
            await loadPaymentHistory()
          }
        }
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

  /**
   * One way out of the confirm sheet, used by ×, the backdrop and the phone's
   * back gesture. A payment in flight asks first — the old guard ignored the
   * close silently, which read as a dead × button.
   */
  function requestClose() {
    if (processing) {
      setCloseAsk(true)
      return
    }
    setShowCheckout(false)
  }

  function forceClose() {
    setCloseAsk(false)
    setProcessing(false)
    setShowCheckout(false)
  }

  function openCheckout(plan: Plan) {
    setCloseAsk(false)
    setProcessing(false)
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

  /** Google Play purchase (Android app only), verified server-side. */
  async function startPlayCheckout() {
    setProcessing(true)
    setError(null)
    setVerificationPending(false)
    try {
      const outcome = await buyPlanWithGooglePlay(selected, user.id)
      if (!outcome.ok) {
        if (outcome.pending) setVerificationPending(true)
        setError(outcome.error)
        return
      }
      if (outcome.expiresAt) {
        await activateFromServer(outcome.expiresAt)
      } else {
        const refreshed = await refreshCurrentSubscription()
        if (refreshed) onSubscribed(refreshed)
        await loadPaymentHistory()
        setSuccess(true)
      }
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : 'Google Play purchase failed.')
    } finally {
      setProcessing(false)
    }
  }

  // Google Play can leave the purchase promise hanging (system UI dismissed, no
  // network). Never let that lock the sheet: after three minutes the buttons
  // come back and the sheet says what to do.
  useEffect(() => {
    if (!inApp || !processing) return
    const timer = window.setTimeout(() => {
      setProcessing(false)
      setError('Google Play has not answered yet. If you completed the payment, reopen Plans — the purchase is restored automatically, and nothing was charged twice.')
    }, 180_000)
    return () => window.clearTimeout(timer)
  }, [inApp, processing])

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

  /**
   * History, read the way a bank statement reads: newest day first, one
   * heading per day with that day's total, then one row per payment. The old
   * table had to be scrolled sideways on a phone and gave no sense of when
   * things happened.
   */
  const historyGroups = useMemo(() => {
    const byDay = new Map<number, PaymentRecord[]>()
    for (const payment of paymentRows) {
      const key = paymentDayStart(payment.createdAt)
      const list = byDay.get(key)
      if (list) list.push(payment)
      else byDay.set(key, [payment])
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([dayStart, items]) => ({
        dayStart,
        label: paymentDayLabel(dayStart),
        items: [...items].sort((a, b) => b.createdAt - a.createdAt),
        total: items.reduce((sum, payment) => sum + (payment.status === 'success' ? payment.amount : 0), 0),
      }))
  }, [paymentRows])

  // Terms and the plan details are pages of text, so they open as pages — not sheets.
  if (showTerms) return <TermsPage onClose={() => setShowTerms(false)} />
  if (showInfo) return <PlanInfoPage inApp={inApp} onClose={() => setShowInfo(false)} />

  return (
    <div className="max-w-3xl mx-auto px-4 pb-6 pt-4 space-y-5">
      {/* Deliberately plain: this page exists so a candidate can buy a pass,
          not so the product can sell one. No gradient, no badge, no hero. */}
      <header className="space-y-1.5">
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Passes</h1>
        <p className="text-sm leading-relaxed text-slate-600">
          Browsing vacancies is free. A pass opens the manager&apos;s name, email and phone number on every job until it
          expires — {inApp ? 'paid with Google Play' : 'paid in secure Razorpay Checkout'}, activated only after the server verifies it.
        </p>
        <div className="flex flex-wrap gap-2">
          {unlocked && activeUntil && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 pulse-dot" /> Active until {activeUntil}
            </span>
          )}
          {!unlocked && expiredPlan?.expiresAt !== undefined && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900 ring-1 ring-amber-200">
              Pass expired on {when(expiredPlan.expiresAt)} — contacts are locked until you renew
            </span>
          )}
        </div>
      </header>

      {catalogError && (
        <div role="alert" className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-sm font-semibold text-amber-900">
          {catalogError} Prices shown are the standard catalog; checkout always uses the live server price.
        </div>
      )}

      {/* Simple price boxes: one per pass, in a plain grid. No badges are used
          to push a plan — only the states a buyer needs (Active/Expired). */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">Choose a pass</div>
          <div className="text-xs font-medium text-slate-500">One payment · no auto-renew</div>
        </div>
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
          {plans.map((plan) => {
            const isSelected = selected.id === plan.id
            // Marked active/purchased: the plan the server ledger says is
            // covering the subscription right now, or the one bought in this
            // session a moment ago.
            const isActive = activePlan?.planId === plan.id
            const activeExpiry = isActive ? activePlan.expiresAt : undefined
            // Ran out: no green badge, an amber Expired badge and a renewal.
            const isExpired = !isActive && expiredPlan?.planId === plan.id
            const boughtAt = purchasedPlans.get(plan.id)
            return (
              <div
                key={plan.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                // The whole box is the target: tapping the price, the days or
                // anywhere else selects this pass. Clicking it again does not
                // start a payment — checkout stays on the button, so a mis-tap
                // can never charge anyone.
                onClick={() => { if (!isSelected) selectPlan(plan.id) }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  if (!isSelected) selectPlan(plan.id)
                }}
                className={`flex cursor-pointer flex-col rounded-2xl border p-3 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-100 ${
                  isSelected ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-200' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{periodLabel(plan.days)}</div>
                <div className="mt-1 text-2xl font-extrabold leading-none tabular-nums text-slate-900">
                  {inApp ? playPrices.get(plan.id) ?? `₹${plan.price}` : `₹${plan.price}`}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {isActive && <Badge color="green">Active</Badge>}
                  {isExpired && <Badge color="amber">Expired</Badge>}
                  {!isActive && isSelected && <Badge color="brand">Selected</Badge>}
                  {!isActive && !isExpired && boughtAt !== undefined && <Badge color="slate">Purchased</Badge>}
                </div>
                {plan.tagline && <div className="mt-1.5 line-clamp-2 text-xs text-slate-600">{plan.tagline}</div>}
                {isActive && activeExpiry !== undefined && (
                  <div className="mt-1.5 text-xs font-bold text-emerald-700">Until {when(activeExpiry)}</div>
                )}
                {isExpired && expiredPlan?.expiresAt !== undefined && (
                  <div className="mt-1.5 text-xs font-bold text-amber-800">Expired {when(expiredPlan.expiresAt)}</div>
                )}
                {!isActive && !isExpired && boughtAt !== undefined && (
                  <div className="mt-1.5 text-xs font-medium text-slate-500">
                    {boughtAt > Date.now() ? `Till ${when(boughtAt)}` : `Ended ${when(boughtAt)}`}
                  </div>
                )}
                <Button
                  variant={isSelected ? 'primary' : 'secondary'}
                  className="mt-3 w-full px-2 py-1.5 text-sm"
                  onClick={(event) => {
                    // Handled here, not twice through the box.
                    event.stopPropagation()
                    if (isSelected) openCheckout(plan)
                    else selectPlan(plan.id)
                  }}
                >
                  {isSelected ? (unlocked ? 'Renew' : isExpired ? 'Renew' : 'Continue') : 'Select'}
                </Button>
              </div>
            )
          })}
        </div>
      </Card>

      {/* One line, one button. The benefits, the payment description and the
          standard terms are reading, so they live on their own page instead of
          pushing the passes down the screen. */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900">Plan benefits, payments &amp; terms</div>
            <div className="text-xs font-medium text-slate-500">
              {inApp ? 'Google Play Billing' : 'Razorpay Checkout'} · one plan per payment · no auto-renew
            </div>
          </div>
          <Button variant="secondary" className="shrink-0" onClick={() => setShowInfo(true)}>
            Read details
          </Button>
        </div>
      </Card>

      {/* Payment history, date by date. Each day gets a heading and a total;
          each payment is a row with its own receipt. */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold text-slate-900">Payment history</div>
          <Badge color="slate">
            {paymentRows.length} {paymentRows.length === 1 ? 'record' : 'records'}
          </Badge>
        </div>
        {paymentRows.length === 0 ? (
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            No payments yet. Your first pass will appear here with its date, amount and receipt.
          </div>
        ) : (
          <div className="space-y-4">
            {historyGroups.map((group) => (
              <div key={group.dayStart}>
                <div className="flex items-baseline justify-between gap-2 px-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{group.label}</div>
                  <div className="text-[11px] font-semibold tabular-nums text-slate-400">
                    {group.items.length} {group.items.length === 1 ? 'payment' : 'payments'} · ₹{group.total} paid
                  </div>
                </div>
                <div className="mt-1.5 space-y-2">
                  {group.items.map((payment) => (
                    <div key={payment.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-900">
                            {planTitle(payment.planTitle ?? payment.planId)}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-slate-500">
                            {new Date(payment.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            {payment.planDays ? ` · ${daysLabel(payment.planDays)}` : ''}
                            {payment.paymentMethod ? ` · ${payment.paymentMethod}` : ''}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-base font-extrabold tabular-nums text-slate-900">₹{payment.amount}</div>
                          <Badge color={payment.status === 'success' ? 'green' : payment.status === 'pending' ? 'amber' : 'red'}>
                            {paymentStatusLabel(payment.status, payment.manualReview)}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          className="px-2.5 py-1.5 text-xs"
                          onClick={() => setHistoryPayment(payment)}
                        >
                          🧾 Receipt
                        </Button>
                        {payment.refundStatus && payment.refundStatus !== 'none' && (
                          <span className="text-xs font-semibold text-slate-600">Refund {payment.refundStatus}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {!inApp && paymentRows.some((payment) => payment.paymentMethod === 'UPI' && payment.status === 'pending' && !payment.manualReview) && (
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

      <Modal open={showCheckout} onClose={requestClose} title="Confirm your plan">
        {success ? (
          <div role="status" className="text-center py-6 space-y-2">
            <div className="text-5xl">✅</div>
            <h2 className="text-lg font-extrabold text-slate-900">Payment verified — plan active</h2>
            <p className="text-sm text-slate-700">
              {planTitle(selected.title)} ({daysLabel(selected.days)}) is marked active on your Plans page.
            </p>
            {confirmedUntil && (
              <p className="text-base font-extrabold text-emerald-700">Active until {confirmedUntil}</p>
            )}
            <Button className="w-full mt-2" onClick={() => setShowCheckout(false)}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {closeAsk && (
              <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-300">
                <div className="text-sm font-bold text-amber-950">A payment is still open</div>
                <p className="text-xs text-amber-900">
                  If you close now, the payment can still complete on its own — reopen Plans and the pass is
                  restored automatically. You are never charged twice for one pass.
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setCloseAsk(false)}>Keep waiting</Button>
                  <Button variant="ghost" className="flex-1" onClick={forceClose}>Close anyway</Button>
                </div>
              </div>
            )}
            <div className="rounded-xl bg-indigo-50 p-4 ring-1 ring-indigo-200 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-900">{planTitle(selected.title)}</div>
                <div className="text-sm font-semibold text-slate-700">
                  {accessLabel(selected.days)}
                </div>
              </div>
              <div className="text-2xl font-extrabold text-indigo-900">{inApp ? playPrices.get(selected.id) ?? `₹${selected.price}` : `₹${selected.price}`}</div>
            </div>

            {inApp && !verificationPending && (
              <>
                <Button className="w-full" onClick={() => { void startPlayCheckout() }} disabled={processing}>
                  {processing ? 'Opening Google Play…' : `Buy ${selected.days}-day pass with Google Play`}
                </Button>
                <p className="text-xs text-slate-700 text-center">Google Play charges the payment method on your Play account. This is a one-time pass — it does not renew by itself.</p>
              </>
            )}

            {!inApp && !verificationPending && (
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
                <p className="text-sm text-amber-900 mt-1">{inApp ? 'Do not buy again. Google Play will confirm the payment and your plan activates automatically — reopen Plans to check.' : 'Do not make another payment. We will check again automatically; the plan stays locked until Razorpay confirms capture.'}</p>
                {pendingCheckout && (
                  <p className="mt-2 text-xs font-mono text-amber-900 break-all">Payment ID: {pendingCheckout.razorpay_payment_id}</p>
                )}
                {!inApp && (
                  <Button variant="secondary" className="w-full mt-3" onClick={() => { void checkPaymentStatus() }} disabled={processing}>
                    {processing ? 'Checking…' : 'Check payment status'}
                  </Button>
                )}
              </div>
            )}

            {error && <div role="alert" className="rounded-lg bg-red-50 text-red-900 text-sm font-medium px-3 py-2 ring-1 ring-red-300">{error}</div>}
            {inApp ? (
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-800 space-y-1">
                <p>1. Check the plan and price, then tap Buy — Google Play shows its own secure payment sheet.</p>
                <p>2. Approve the payment in Google Play. Never share your passwords or OTP with anyone, including support.</p>
                <p>3. Return here and wait for confirmation. If charged but not activated, do not buy again; reopen the app and visit Plans, or contact support with your Google Play order ID (GPA…).</p>
                <p>Access begins after Google confirms and our server verifies the purchase. Renewals add {daysLabel(selected.days)} to your existing expiry (or start now if expired).</p>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-800 space-y-1">
                <p>1. Check the plan and amount, then open Razorpay Checkout.</p>
                <p>2. In Razorpay choose a card, or UPI → PhonePe, Google Pay, another available app, or QR if offered. Approve payment only inside your bank/UPI app; never share your PIN or OTP here.</p>
                <p>3. Return here and wait for server confirmation. If charged but not activated, do not pay again; use Check payment status or contact support with the payment ID.</p>
                <p>Access begins after verified capture. Renewals add {daysLabel(selected.days)} to your existing expiry (or start now if expired).</p>
              </div>
            )}
          </div>
        )}
      </Modal>


      {/* A receipt is a decision-free read of one payment: a sheet is fine, and
          it keeps the reference copyable without leaving the page. */}
      <Modal
        open={!!historyPayment}
        onClose={() => setHistoryPayment(null)}
        title="Payment receipt"
      >
        {historyPayment && (
          <div className="space-y-3 text-sm">
            <div className="rounded-2xl bg-slate-50 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Plan</div>
              <div className="text-base font-extrabold text-slate-900">
                {planTitle(historyPayment.planTitle ?? historyPayment.planId)}
              </div>
              <div className="text-xs text-slate-600">
                {new Date(historyPayment.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                {historyPayment.planDays ? ` · ${daysLabel(historyPayment.planDays)}` : ''}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <ReceiptField label="Amount" value={`₹${historyPayment.amount}`} />
              <ReceiptField label="Status" value={paymentStatusLabel(historyPayment.status, historyPayment.manualReview)} />
              <ReceiptField label="Method" value={historyPayment.paymentMethod ?? '—'} />
              <ReceiptField label="Reference" value={historyPayment.gatewayPaymentId ?? historyPayment.txRef ?? '—'} mono />
              <ReceiptField label="UTR" value={historyPayment.utr || '—'} mono />
              <ReceiptField
                label="Access until"
                value={historyPayment.expiresAt
                  ? new Date(historyPayment.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })
                  : '—'}
              />
            </dl>
            {historyPayment.refundStatus && historyPayment.refundStatus !== 'none' && (
              <p className="text-xs font-semibold text-slate-600">
                Refund {historyPayment.refundStatus}{historyPayment.refundRef ? ` · ${historyPayment.refundRef}` : ''}
              </p>
            )}
            <p className="text-xs text-slate-500">
              Keep the reference when writing to support. We never ask for a bank PIN, UPI PIN or OTP.
            </p>
            <Button className="w-full" onClick={() => setHistoryPayment(null)}>Close</Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
