import { useRef, useState } from 'react'
import { Button, Card, Input } from '../components/ui'
import { createTicket } from '../data/tickets'
import type { User } from '../data/auth'
import { isSubscribed } from '../data/auth'
import { answer, safeReply, ticketCreatedMsg, type Answer } from '../data/aiHelp'
import { getPaymentsByUser, requestRefund } from '../data/payments'

type Msg = { role: 'user' | 'bot'; text: string; kind?: 'ticket' | 'ask' }

const CHIPS = ['Plans & pricing', 'How to apply', 'Track subscription', 'Payment & refunds', 'I need support']

export function AIChatScreen({ user }: { user: User }) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'bot',
      text: safeReply(
        `Hi ${user.name.split(' ')[0]} 👋 I'm MedRep AI.\n\nI answer MedRep Connect Pro app questions ONLY — jobs, plans, applying, subscriptions, payments, profile, notifications.\n\nIf you need extra assistance, I'll ask your permission first and only then create a support ticket for the admin.`,
      ),
    },
  ])
  const [input, setInput] = useState('')
  const [consent, setConsent] = useState<NonNullable<Answer['askTicket']>>({ kind: 'support', subject: 'Support request (from AI Help)' })
  const [consentPending, setConsentPending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  function scrollDown() {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, 50)
  }

  function push(msgs: Msg[]) {
    setMessages((m) => [...m, ...msgs])
    scrollDown()
  }

  function createTicketNow() {
    const kind = consent?.kind ?? 'support'
    let message = ''
    let paymentId: string | undefined
    if (kind === 'refund') {
      const pay = requestRefund(user.id)
      paymentId = pay?.id
      const history = getPaymentsByUser(user.id).slice(0, 3)
      message =
        `User requested a refund (raised from AI Help with user's permission).\n` +
        (pay
          ? `Latest payment: TXN ${pay.txRef ?? '—'} · UTR ${pay.utr || '—'} · ₹${pay.amount} · plan ${pay.planId} · paid ${new Date(pay.createdAt).toLocaleString()}`
          : `No confirmed payment found on this account — user says they were charged; please verify manually.`) +
        (history.length > 1 ? `\nRecent payments: ${history.map((p) => `${p.txRef ?? p.id} (₹${p.amount}, UTR ${p.utr || '—'})`).join('; ')}` : '')
    } else {
      message = `User needs additional assistance (raised from AI Help with user's permission). Recent chat context is available with the user.`
    }
    const t = createTicket({
      userId: user.id,
      email: user.email,
      name: user.name,
      subject: consent?.subject ?? 'Support request (from AI Help)',
      message,
      source: 'ai',
      kind,
      paymentId,
    })
    setConsentPending(false)
    push([{ role: 'bot', text: safeReply(ticketCreatedMsg(kind, t.id)), kind: 'ticket' }])
  }

  function declineTicket() {
    setConsentPending(false)
    push([{ role: 'bot', text: 'No problem! 👍 I\'m here if you need anything else about the app.' }])
  }

  function handle(text: string) {
    const t = text.trim()
    if (!t) return
    push([{ role: 'user', text: t }])
    setInput('')

    // Ticket permission flow — never create a ticket without explicit consent
    if (consentPending) {
      if (/^(yes|yeah|yep|ok|okay|sure|create|do it|haan|please do)\b/i.test(t)) {
        createTicketNow()
        return
      }
      if (/^(no|nope|cancel|leave it|nahi|not now)\b/i.test(t)) {
        declineTicket()
        return
      }
      // ambiguous → ask again with buttons
      push([{ role: 'bot', text: 'Please choose: should I create the support ticket, or not?', kind: 'ask' }])
      return
    }

    const res = answer(t, isSubscribed(user))
    const botMsgs: Msg[] = [{ role: 'bot', text: safeReply(res.text) }]
    if (res.askTicket) {
      setConsent(res.askTicket)
      setConsentPending(true)
      botMsgs.push({
        role: 'bot',
        text: '🔒 I will only create a ticket if you say yes — do I have your permission?',
        kind: 'ask',
      })
    }
    push(botMsgs)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-28 pt-4 flex flex-col h-[calc(100svh-64px)]">
      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white grid place-items-center text-lg">🤖</div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900">MedRep AI · App help</div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot" /> App questions only · tickets only with your permission
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/60">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
          ))}

          {/* Permission buttons — ticket is created ONLY on explicit tap/yes */}
          {consentPending && (
            <div className="flex gap-2 justify-start pl-1">
              <Button onClick={createTicketNow}>✅ Yes, create ticket</Button>
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
          <Button className="shrink-0" onClick={() => handle(input)}>Send</Button>
        </div>
      </Card>
    </div>
  )
}
