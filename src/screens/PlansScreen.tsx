import { useMemo, useState } from 'react'
import { Badge, Button, Card, Input, Label, Modal } from '../components/ui'
import { getDefaultPaymentMethod, getPaymentMethods, getPaymentsByUser, recordPayment, type PaymentMethod, type PaymentRecord } from '../data/payments'
import { getPlans, type Plan } from '../data/plans'
import { currentUser, isSubscribed, type User } from '../data/auth'

export function PlansScreen({
  user,
  onSubscribed,
}: {
  user: User
  onSubscribed: (u: User) => void
}) {
  const plans = useMemo(() => getPlans(), [])
  const [selected, setSelected] = useState<Plan>(plans.find((p) => p.popular) ?? plans[0])
  const [method, setMethod] = useState<PaymentMethod | undefined>(getDefaultPaymentMethod())
  const [showCheckout, setShowCheckout] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [upiId, setUpiId] = useState('')
  const [utr, setUtr] = useState('')
  const [success, setSuccess] = useState(false)
  const unlocked = isSubscribed(user)
  const activeUntil = user.subscribedUntil ? new Date(user.subscribedUntil).toLocaleDateString() : null
  const myPayments = getPaymentsByUser(user.id)

  function openCheckout(p: Plan) {
    setSelected(p)
    setMethod(getDefaultPaymentMethod())
    setUpiId('')
    setUtr('')
    setSuccess(false)
    setShowCheckout(true)
  }

  function pay() {
    setProcessing(true)
    // Simulated Razorpay/UPI flow — on confirmation, recordPayment auto-activates
    // the plan with the expiry date as per plan days and syncs to admin (Supabase-ready).
    setTimeout(() => {
      recordPayment({
        userId: user.id,
        planId: selected.id,
        amount: selected.price,
        methodId: method?.id,
        status: 'success',
        planDays: selected.days,
        utr: utr.trim() || undefined,
      })
      // recordPayment already auto-activated the plan with the per-plan expiry.
      const updated = currentUser()
      setProcessing(false)
      setSuccess(true)
      if (updated) {
        setTimeout(() => {
          setShowCheckout(false)
          onSubscribed(updated)
        }, 1200)
      }
    }, 1200)
  }

  const savedMethods = getPaymentMethods()

  return (
    <div className="max-w-3xl mx-auto px-4 pb-28 pt-4 space-y-5">
      <Card className="p-5 bg-gradient-to-br from-brand-50 to-indigo-50 border-brand-200">
        <div className="text-[11px] font-bold uppercase tracking-widest text-brand-700">Subscription</div>
        <h1 className="text-xl font-extrabold text-slate-900 mt-1">Unlock company details, manager contacts & apply</h1>
        <p className="text-sm text-slate-700 mt-1">
          Pay via Razorpay (cards, UPI, netbanking) or directly to our UPI ID. All plans fully unlock every vacancy on the hub.
        </p>
        {unlocked && activeUntil && (
          <div className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-full ring-1 ring-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot" /> Active until {activeUntil}
          </div>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((p) => {
          const isSel = selected.id === p.id
          return (
            <Card key={p.id} className={`p-4 relative ${isSel ? 'ring-2 ring-brand-500' : ''} ${p.popular ? 'bg-gradient-to-br from-white to-brand-50' : ''}`}>
              {p.popular && (
                <div className="absolute -top-2 right-3">
                  <Badge color="brand">Most popular</Badge>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="font-bold text-slate-900">{p.title}</div>
                <div className="text-2xl font-extrabold text-brand-700">₹{p.price}</div>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {p.days >= 365
                  ? `${Math.round(p.days / 365)} year`
                  : p.days >= 30
                    ? `${Math.round(p.days / 30)} month${p.days >= 60 ? 's' : ''}`
                    : `${p.days} days`}
              </div>
              <div className="text-sm text-slate-700 mt-2">{p.tagline}</div>
              <Button variant={isSel ? 'primary' : 'secondary'} className="w-full mt-3" onClick={() => openCheckout(p)}>
                {unlocked ? 'Extend / Renew' : 'Subscribe'}
              </Button>
            </Card>
          )
        })}
      </div>

      <Card className="p-4">
        <div className="text-sm font-semibold text-slate-900 mb-1">What you get</div>
        <ul className="text-sm text-slate-700 space-y-1 list-disc pl-5">
          <li>Full company name, manager & contact number for every job</li>
          <li>One-tap Apply with confirmation sheet</li>
          <li>Priority placement alerts & pinned jobs</li>
          <li>AI chat help & admin ticket escalation</li>
        </ul>
      </Card>

      {/* User payment monitor — every transaction with reference + UTR */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="text-sm font-semibold text-slate-900">Your payments</div>
          <Badge color="slate">{myPayments.length} txn</Badge>
        </div>
        {myPayments.length === 0 ? (
          <div className="text-xs text-slate-500">No transactions yet. After paying, your payment reference and UTR appear here.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead className="text-slate-500 text-left">
                <tr>
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Reference</th>
                  <th className="py-1 pr-2">UTR</th>
                  <th className="py-1 pr-2">Amount</th>
                  <th className="py-1 pr-2">Status</th>
                  <th className="py-1 pr-2">Refund</th>
                </tr>
              </thead>
              <tbody>
                {myPayments.map((p: PaymentRecord) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2 text-slate-600">{new Date(p.createdAt).toLocaleDateString()}</td>
                    <td className="py-1.5 pr-2 font-mono text-slate-800">{p.txRef ?? '—'}</td>
                    <td className="py-1.5 pr-2 font-mono text-slate-600">{p.utr || '—'}</td>
                    <td className="py-1.5 pr-2 font-bold text-slate-900">₹{p.amount}</td>
                    <td className="py-1.5 pr-2"><Badge color={p.status === 'success' ? 'green' : p.status === 'pending' ? 'amber' : 'red'}>{p.status}</Badge></td>
                    <td className="py-1.5 pr-2">
                      {p.refundStatus === 'approved' ? (
                        <Badge color="green">Refunded{p.refundRef ? ` · ${p.refundRef}` : ''}</Badge>
                      ) : p.refundStatus === 'requested' ? (
                        <Badge color="amber">Under review</Badge>
                      ) : p.refundStatus === 'rejected' ? (
                        <Badge color="slate">Not approved</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showCheckout} onClose={() => !processing && setShowCheckout(false)} title={`Subscribe · ${selected.title}`}>
        {success ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">✅</div>
            <div className="text-lg font-bold text-slate-900">Payment successful!</div>
            <div className="text-sm text-slate-500 mt-1">Jobs are now unlocked.</div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">{selected.title}</div>
                <div className="text-xs text-slate-500">{selected.tagline}</div>
              </div>
              <div className="text-2xl font-extrabold text-brand-700">₹{selected.price}</div>
            </div>

            <div>
              <Label>Payment method</Label>
              <div className="grid gap-2">
                {savedMethods.length === 0 && (
                  <div className="text-xs text-slate-500 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                    Admin has not set up payment methods yet. You can still simulate checkout below.
                  </div>
                )}
                {savedMethods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`w-full rounded-xl px-3 py-2 text-left ring-1 transition ${
                      method?.id === m.id ? 'ring-brand-500 bg-brand-50' : 'ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">
                      {m.mode === 'UPI' ? 'UPI · ' : 'Razorpay · '}
                      {m.label}
                    </div>
                    <div className="text-xs text-slate-500">
                      {m.mode === 'UPI' ? `VPA: ${m.upiVpa}` : 'Secured checkout · auto-activates on confirmation'}
                    </div>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setMethod(undefined)}
                  className={`w-full rounded-xl px-3 py-2 text-left ring-1 transition ${
                    method === undefined ? 'ring-brand-500 bg-brand-50' : 'ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900">Pay with UPI ID</div>
                  <div className="text-xs text-slate-500">Enter any UPI ID for this demo</div>
                </button>
              </div>
            </div>

            {method === undefined && (
              <div>
                <Label htmlFor="upi">Your UPI ID</Label>
                <Input id="upi" placeholder="yourname@okicici" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
              </div>
            )}

            <div>
              <Label htmlFor="utr">Transaction reference / UTR (optional)</Label>
              <Input
                id="utr"
                placeholder="e.g. 415023456789 · from your UPI app / bank SMS"
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                autoComplete="off"
              />
              <div className="text-[11px] text-slate-500 mt-1">
                Adding the UTR helps the admin verify and track your payment, and speeds up any refund.
              </div>
            </div>

            <div className="text-[11px] text-slate-500">
              ⚠️ This is a simulated checkout — no real payment is processed. Wire real Razorpay/UPI in production.
            </div>

            <Button className="w-full" onClick={pay} disabled={processing}>
              {processing ? 'Processing…' : `Pay ₹${selected.price}`}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
