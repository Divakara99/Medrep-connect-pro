import { useEffect, useRef, useState } from 'react'
import { Button, Card, Input } from '../components/ui'
import type { User } from '../data/auth'
import { isSubscribed } from '../data/auth'
import { answer, classify, safeReply } from '../data/aiHelp'
import { getPaymentsByUser, refreshPayments, type PaymentRecord } from '../data/payments'
import { getProfile } from '../data/profile'
import {
  checkRefundReason,
  descriptionProblem,
  REFUND_REASONS,
  reasonLabel,
  type RefundCheckResult,
  type RefundReasonCode,
  type RefundVerdict,
} from '../data/refundCheck'
import {
  createSupportRequest,
  getCachedSupportRequests,
  listMySupportRequests,
  ticketNumber,
  type SupportRequest,
} from '../data/supportRequests'

type Option = { id: string; label: string }
type Msg = { role: 'user' | 'bot'; text: string; kind?: 'ticket' | 'ask'; options?: Option[] }

/** A request the user has agreed to send. Nothing is sent before the user taps yes. */
type Consent = {
  kind: 'support' | 'refund'
  subject: string
  message?: string
  reasonCode?: RefundReasonCode
  paymentId?: string
  details?: Record<string, unknown>
}

type RefundFlow =
  | { step: 'reason' }
  | { step: 'payment'; reason: RefundReasonCode }
  | { step: 'details'; reason: RefundReasonCode; paymentId: string }
  | { step: 'review'; reason: RefundReasonCode; paymentId: string; description: string; result: RefundCheckResult }

const CHIPS = ['Plans & pricing', 'How to apply', 'Track subscription', 'Payment & refunds', 'I need support']
const SUPPORT_SUBJECT = 'Support request (from AI Help)'
const REFUND_INTRO =
  'Refunds are only possible in these cases:\n' +
  '• Money was deducted but your plan did not activate\n' +
  '• You were charged twice for the same plan\n' +
  '• A payment failed but money was debited\n\n' +
  'Otherwise plans are non-refundable once activated (Terms, section 6). Which one matches your situation?'

const PAYMENT_STATUS: Record<PaymentRecord['status'], string> = {
  success: 'Paid',
  pending: 'Pending',
  failed: 'Failed',
  rejected: 'Rejected',
}

function reviewOptions(verdict: RefundVerdict): Option[] {
  return verdict === 'not_eligible'
    ? [
        { id: 'review:support', label: 'Raise a support request instead' },
        { id: 'review:cancel', label: '✖ Cancel' },
      ]
    : [
        { id: 'review:submit', label: '✅ Yes, raise refund request' },
        { id: 'review:cancel', label: '✖ Cancel' },
      ]
}

function formatVerdict(result: RefundCheckResult): string {
  const lock = result.verdict === 'not_eligible' ? '' : '\n\n🔒 Nothing is sent until you tap "Yes, raise refund request".'
  return `${result.title}\n\n${result.explanation}\n\nNext: ${result.nextStep}${lock}`
}

function ticketMessage(request: SupportRequest): string {
  const num = ticketNumber(request.id)
  return request.kind === 'refund'
    ? `✅ Refund request #${num} is open. We sent the reason, your payment details and your account details to the administrator. Track it under Account → My requests.`
    : `✅ Support request #${num} is open. The administrator will reply in Account → My requests.`
}

export function AIChatScreen({ user }: { user: User }) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'bot',
      text: safeReply(
        `Hi ${user.name.split(' ')[0]} 👋 I'm MedRep AI.\n\nI answer MedRep Connect Pro app questions ONLY — jobs, plans, applying, subscriptions, payments, profile, notifications.\n\nFor a refund I will check your payment with you step by step. If you need extra help, I'll ask your permission first and only then send a request to the admin.`,
      ),
    },
  ])
  const [input, setInput] = useState('')
  const [consent, setConsent] = useState<Consent>({ kind: 'support', subject: SUPPORT_SUBJECT })
  const [consentPending, setConsentPending] = useState(false)
  const [flow, setFlow] = useState<RefundFlow | null>(null)
  const [busy, setBusy] = useState(false)
  const [payments, setPayments] = useState<PaymentRecord[]>(() => getPaymentsByUser(user.id))
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    void refreshPayments()
      .then((all) => {
        if (active) setPayments(all.filter((p) => p.userId === user.id))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [user.id])

  function scrollDown() {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, 50)
  }

  function push(msgs: Msg[]) {
    setMessages((m) => [
      ...m,
      ...msgs.map((msg) => (msg.role === 'bot' ? { ...msg, text: safeReply(msg.text) } : msg)),
    ])
    scrollDown()
  }

  function recentChat(): string {
    return messages
      .slice(-6)
      .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`)
      .join('\n')
      .slice(0, 1500)
  }

  /** Account snapshot sent with every request, so the admin does not have to ask for it. */
  function accountDetails(extra: Record<string, unknown>): Record<string, unknown> {
    const profile = getProfile(user.email)
    return {
      name: user.name,
      accountEmail: user.email,
      phone: profile.phone || user.phone || null,
      city: profile.city || null,
      state: profile.state || null,
      subscribed: isSubscribed(user),
      subscribedUntil: user.subscribedUntil ? new Date(user.subscribedUntil).toISOString() : null,
      chatExcerpt: recentChat(),
      ...extra,
    }
  }

  async function submit(c: Consent) {
    setBusy(true)
    const result = await createSupportRequest({
      kind: c.kind,
      subject: c.subject,
      message: c.message ?? `Raised from AI Help with the user's permission.\n\nRecent chat:\n${recentChat()}`,
      reasonCode: c.reasonCode,
      paymentId: c.paymentId,
      details: accountDetails(c.details ?? {}),
    })
    setBusy(false)
    setConsentPending(false)
    setFlow(null)
    if (!result.ok) {
      push([{ role: 'bot', text: `⚠️ ${result.error}` }])
      return
    }
    push([{ role: 'bot', text: ticketMessage(result.request), kind: 'ticket' }])
  }

  /** Ask permission before a support request. Nothing is sent without a yes. */
  function askSupport(lead: string, extra: Partial<Consent> = {}) {
    setFlow(null)
    setConsent({ kind: 'support', subject: SUPPORT_SUBJECT, ...extra })
    setConsentPending(true)
    push([
      { role: 'bot', text: lead },
      { role: 'bot', text: '🔒 I will only send a support request if you say yes — shall I?', kind: 'ask' },
    ])
  }

  function paymentChoices(): Option[] {
    return [...payments]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6)
      .map((p) => ({
        id: `pay:${p.id}`,
        label: `₹${p.amount} · ${p.planTitle ?? p.planId} · ${new Date(p.createdAt).toLocaleDateString('en-IN')} · ${PAYMENT_STATUS[p.status]}`,
      }))
  }

  function startRefund() {
    setFlow({ step: 'reason' })
    push([
      {
        role: 'bot',
        text: REFUND_INTRO,
        options: [
          ...REFUND_REASONS.map((r) => ({ id: `reason:${r.code}`, label: r.label })),
          { id: 'reason:other', label: 'Something else' },
        ],
      },
    ])
  }

  async function reviewRefund(reason: RefundReasonCode, paymentId: string, description: string) {
    const payment = payments.find((p) => p.id === paymentId)
    if (!payment) {
      setFlow(null)
      push([{ role: 'bot', text: 'That payment is no longer on your account. Please start the refund check again.' }])
      return
    }
    setBusy(true)
    const existing: SupportRequest[] = await listMySupportRequests().catch(() => getCachedSupportRequests() ?? [])
    setBusy(false)
    const result = checkRefundReason({
      reasonCode: reason,
      payment,
      payments,
      hasRefundRequest: existing.some((r) => r.kind === 'refund' && r.paymentId === paymentId),
    })
    setFlow({ step: 'review', reason, paymentId, description, result })
    push([{ role: 'bot', text: formatVerdict(result), options: reviewOptions(result.verdict) }])
  }

  function chooseOption(option: Option) {
    if (busy) return
    push([{ role: 'user', text: option.label }])
    const id = option.id

    if (id.startsWith('reason:')) {
      const code = id.slice('reason:'.length)
      if (code === 'other') {
        askSupport('Refunds only apply to the cases listed above. If your issue is something else, I can send a support request so an administrator can review it.')
        return
      }
      const reason = code as RefundReasonCode
      setFlow({ step: 'payment', reason })
      const choices = paymentChoices()
      push([
        {
          role: 'bot',
          text: choices.length
            ? 'Which payment is this about?'
            : "I can't find any payment on your account. If you were charged, tap \"I can't see my payment\" and an administrator can check your bank statement.",
          options: [...choices, { id: 'pay:none', label: "I can't see my payment" }],
        },
      ])
      return
    }

    if (id === 'pay:none') {
      askSupport('I cannot start a refund without a payment on your account. I can send a support request so an administrator can check your bank statement.', {
        details: { refundCheck: 'payment_not_found' },
      })
      return
    }

    if (id.startsWith('pay:')) {
      if (flow?.step !== 'payment') return
      setFlow({ step: 'details', reason: flow.reason, paymentId: id.slice('pay:'.length) })
      push([
        {
          role: 'bot',
          text: 'Thanks. In one or two sentences, tell me what happened: the date, the amount, and what you saw in the app. (At least 20 characters.)',
        },
      ])
      return
    }

    if (flow?.step !== 'review') return
    if (id === 'review:submit') {
      void submit({
        kind: 'refund',
        subject: `Refund: ${reasonLabel(flow.reason)}`,
        message: flow.description,
        reasonCode: flow.reason,
        paymentId: flow.paymentId,
        details: {
          reasonLabel: reasonLabel(flow.reason),
          description: flow.description,
          aiVerdict: flow.result.verdict,
          aiSummary: flow.result.title,
        },
      })
      return
    }
    if (id === 'review:support') {
      askSupport(`Your payment does not meet the refund rules, so I cannot raise a refund request. I can send your details to an administrator to review instead.`, {
        subject: `Refund query: ${reasonLabel(flow.reason)}`,
        message: `Refund not approved automatically (${flow.result.verdict}): ${flow.result.title}\n\nUser says: ${flow.description}`,
        reasonCode: flow.reason,
        paymentId: flow.paymentId,
        details: { reasonLabel: reasonLabel(flow.reason), description: flow.description, aiVerdict: flow.result.verdict },
      })
      return
    }
    if (id === 'review:cancel') {
      setFlow(null)
      push([{ role: 'bot', text: 'No problem, nothing was sent. I can help with anything else about the app.' }])
    }
  }

  function declineTicket() {
    setConsentPending(false)
    push([{ role: 'bot', text: "No problem! 👍 I'm here if you need anything else about the app." }])
  }

  /** Typed input while a refund check is in progress. */
  function handleFlowText(t: string) {
    if (!flow) return
    if (/^(cancel|stop|nevermind|never mind)\b/i.test(t)) {
      setFlow(null)
      push([{ role: 'bot', text: 'Cancelled. Nothing was sent.' }])
      return
    }
    if (flow.step === 'reason') {
      push([{ role: 'bot', text: 'Please tap the reason that matches your situation.', options: REFUND_REASONS.map((r) => ({ id: `reason:${r.code}`, label: r.label })).concat({ id: 'reason:other', label: 'Something else' }) }])
      return
    }
    if (flow.step === 'payment') {
      push([{ role: 'bot', text: 'Please tap the payment this is about.', options: [...paymentChoices(), { id: 'pay:none', label: "I can't see my payment" }] }])
      return
    }
    if (flow.step === 'details') {
      const problem = descriptionProblem(t)
      if (problem) {
        push([{ role: 'bot', text: problem }])
        return
      }
      void reviewRefund(flow.reason, flow.paymentId, t)
      return
    }
    push([{ role: 'bot', text: 'Please tap one of the options below, or type cancel.', options: reviewOptions(flow.result.verdict) }])
  }

  function handle(text: string) {
    const t = text.trim()
    if (!t || busy) return
    push([{ role: 'user', text: t }])
    setInput('')

    // Permission flow: never send a request without explicit consent
    if (consentPending) {
      if (/^(yes|yeah|yep|ok|okay|sure|create|do it|haan|please do)\b/i.test(t)) {
        void submit(consent)
        return
      }
      if (/^(no|nope|cancel|leave it|nahi|not now)\b/i.test(t)) {
        declineTicket()
        return
      }
      push([{ role: 'bot', text: 'Please choose: should I send the support request, or not?', kind: 'ask' }])
      return
    }

    if (flow) {
      handleFlowText(t)
      return
    }

    if (classify(t) === 'refund') {
      startRefund()
      return
    }

    const res = answer(t, isSubscribed(user))
    const botMsgs: Msg[] = [{ role: 'bot', text: res.text }]
    if (res.askTicket) {
      setConsent({ kind: 'support', subject: res.askTicket.subject || SUPPORT_SUBJECT })
      setConsentPending(true)
      botMsgs.push({
        role: 'bot',
        text: '🔒 I will only send a support request if you say yes — do I have your permission?',
        kind: 'ask',
      })
    }
    push(botMsgs)
  }

  const lastIndex = messages.length - 1

  return (
    <div className="max-w-3xl mx-auto px-4 pb-4 pt-4 flex flex-col h-[calc(100svh-64px)]">
      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white grid place-items-center text-lg">🤖</div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900">MedRep AI · App help</div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot" /> App questions only · requests only with your permission
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/60">
          {messages.map((m, i) => (
            <div key={i} className="space-y-2">
              <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-brand-600 text-white rounded-br-md'
                      : m.kind === 'ticket'
                        ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 rounded-bl-md'
                        : m.kind === 'ask'
                          ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200 rounded-bl-md'
                          : 'bg-white text-slate-800 ring-1 ring-slate-200 rounded-bl-md'
                  }`}
                >
                  {m.text}
                </div>
              </div>
              {m.options && i === lastIndex && (
                <div className="flex flex-wrap gap-2 justify-start pl-1">
                  {m.options.map((o) => (
                    <Button key={o.id} variant="secondary" disabled={busy} onClick={() => chooseOption(o)}>
                      {o.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Permission buttons: a request is sent ONLY on an explicit tap or yes */}
          {consentPending && (
            <div className="flex gap-2 justify-start pl-1">
              <Button disabled={busy} onClick={() => void submit(consent)}>✅ Yes, send request</Button>
              <Button variant="secondary" onClick={declineTicket}>✖ No, thanks</Button>
            </div>
          )}
        </div>

        {/* Quick chips */}
        <div className="px-3 pt-2 flex gap-2 overflow-x-auto no-scrollbar bg-white">
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handle(c)}
              className="shrink-0 rounded-full bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 px-3 py-1.5 touch-manipulation"
            >
              {c}
            </button>
          ))}
        </div>

        <div className="border-t border-slate-100 p-3 flex gap-2 bg-white">
          <Input
            className="min-w-0 flex-1"
            placeholder="Ask about the app: jobs, plans, apply, payments…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handle(input)
            }}
          />
          <Button className="shrink-0" disabled={busy} onClick={() => handle(input)}>Send</Button>
        </div>
      </Card>
    </div>
  )
}
