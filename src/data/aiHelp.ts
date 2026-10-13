import { getPlans } from './plans'
import { isSecretProbe, sanitizeSecrets } from './secrets'
import { CREATOR } from './creator'

/**
 * MedRep AI Help — answers APP-RELATED questions only.
 * - Never reveals secrets (enforced by isSecretProbe + sanitizeSecrets).
 * - Never creates a support ticket without the user's explicit permission.
 * - Handles refund requests by explaining policy + permission-gated ticket.
 */

export type Intent = 'secret' | 'refund' | 'human' | 'app' | 'offtopic' | 'greeting'
export type Answer = {
  text: string
  intent: Intent
  /** When set, the AI wants to open a ticket and is asking the user's permission. */
  askTicket?: { kind: 'support' | 'refund'; subject: string }
}

const CREATOR_PUBLIC = `Mr. ${CREATOR.name} — ${CREATOR.role}`

function planLine(): string {
  const plans = getPlans()
  if (plans.length === 0) return 'Plans start from ₹49 (5 days) up to ₹1799 (1 year).'
  return plans
    .map((p) => `• ${p.title} — ₹${p.price} (${p.days} days)`)
    .join('\n')
}

export function classify(q: string): Intent {
  if (isSecretProbe(q)) return 'secret'
  const Q = q.toLowerCase()
  if (/refund|money\s?back|chargeback|charged\s?(twice|extra|wrong)|debited|deducted|paisa|wapis|return my money/.test(Q)) return 'refund'
  if (/talk|speak|call|connect|real person|human|agent|manager/.test(Q) && /admin|support|human|person|agent|help/.test(Q)) return 'human'
  if (/^(hi|hello|hey|namaste|vanakkam|good\s?(morning|afternoon|evening))\b/.test(Q)) return 'greeting'
  const appRe = /job|vacanc|opening|role|mr\b|abm|pharma|category|filter|search|priority|pin|plan|price|cost|pricing|subscri|payment|pay\b|upi|razorpay|apply|application|email|whatsapp|profile|account|notif|ticket|support|eligib|experience|fresher|salary|company|contact|download|premium|unlock|expire|renew|login|register|password reset|forgot|creator|owner|divakar|app\b|medrep|notification|sound|admin panel(?!.*(password|login))/
  return appRe.test(Q) ? 'app' : 'offtopic'
}

export function answer(q: string, subscribed: boolean): Answer {
  const intent = classify(q)
  const Q = q.toLowerCase()

  if (intent === 'secret') {
    return {
      intent,
      text:
        '🔒 I can\'t share admin, security, or account-credential details — that\'s locked for everyone\'s safety.\n\n' +
        'I can help with: jobs & search, plans & pricing, how to apply, subscriptions, payments, profile, and notifications. What would you like to know?',
    }
  }

  if (intent === 'refund') {
    // The chat screen runs the guided refund check itself (see AIChatScreen).
    // This fallback only explains the policy.
    return {
      intent,
      text:
        'Refund policy 💳\n\n' +
        '• Refunds are only possible when money was deducted but your plan did not activate, you were charged twice for the same plan, or a payment failed but money was debited.\n' +
        '• Once a plan is active, payments are otherwise non-refundable (see Terms section 6).\n\n' +
        'Tap "Payment & refunds" or type "refund" and I will check your payment with you step by step.',
    }
  }

  if (intent === 'human') {
    return {
      intent,
      text:
        'I can connect you with the admin team 🤝\n\nWith your permission I\'ll create a support ticket containing your query — the admin will respond and you can track it under Tickets.',
      askTicket: { kind: 'support', subject: 'Support request (from AI Help)' },
    }
  }

  if (intent === 'greeting') {
    return {
      intent,
      text:
        `Hi! 👋 I'm MedRep AI — I answer questions about this app only.\n\n` +
        `Try: "plans & pricing", "how to apply", "track my subscription", "payment & refunds", or "I need support".`,
    }
  }

  if (intent === 'offtopic') {
    return {
      intent,
      text:
        'I\'m focused on MedRep Connect Pro app questions only 📱\n\n' +
        'Ask me about jobs, plans & pricing, how to apply, subscriptions, payments/refunds, profile, or notifications.\n\n' +
        'If you need help with something else regarding the app, say "I need support" and I\'ll ask your permission to open a ticket for the admin.',
    }
  }

  // ---- App-related answers ----
  if (/plan|price|cost|pricing|fee|charge|rupee|rs\b|₹/.test(Q)) {
    return {
      intent,
      text:
        `Plans & pricing 💎\n${planLine()}\n\n` +
        `Every plan fully unlocks: company names, manager contacts, and one-tap Apply.\n` +
        `${subscribed ? 'Your subscription is active ✅' : 'Open the Plans tab to subscribe. Razorpay activates after server verification; choose cards or UPI apps in checkout.'}`,
    }
  }
  if (/subscri|activat|expir|renew|validity|valid/.test(Q)) {
    return {
      intent,
      text:
        `Subscription 🔓\n` +
        `• Razorpay access activates only after the server verifies a captured payment.\n` +
        `• The expiry date uses the exact duration of the selected plan; you can see it on Plans and Account.\n` +
        `${subscribed ? '• Your plan is active right now ✅' : '• You are currently on the free plan — subscribe to unlock everything.'}\n` +
        `• If charged but not activated, do not pay again; contact support with the payment ID.`,
    }
  }
  if (/apply|how to apply|send (cv|resume)|email|whatsapp|contact (hr|manager)/.test(Q)) {
    return {
      intent,
      text:
        `How to apply ✉️\n` +
        `1. Complete your profile (education, experience, bio) from the Account tab.\n` +
        `2. Open any job → tap Apply → confirm.\n` +
        `3. If the job has a manager email, your mail app opens with your full profile pre-filled (admin is CC'd).\n` +
        `4. If no manager email is on file, you're taken to WhatsApp with the same ready-made message.\n` +
        `${subscribed ? '' : '\nApply unlocks with any subscription plan.'}`,
    }
  }
  if (/job|vacanc|opening|role|mr\b|abm|pharma|category|filter|search|priority|pin|salary|company|eligib|experience|fresher/.test(Q)) {
    return {
      intent,
      text:
        `Jobs on MedRep Connect Pro 💼\n` +
        `• Medical Representative (MR) vacancies are pinned first (Priority tab), then multi-industry roles (ABM, FMCG, Finance, Banking, IT, Healthcare & more).\n` +
        `• Use Home search + filters (location, category, experience, salary) to narrow results.\n` +
        `• Company names & manager contacts stay blurred for free users and unlock with a subscription.\n` +
        `• Freshers can apply too — complete your profile to improve responses.`,
    }
  }
  if (/profile|account|bio|education|experience|resume|cv|update/.test(Q)) {
    return {
      intent,
      text:
        `Profile & account 👤\n` +
        `• Your tagline is fixed as "Job Seeker".\n` +
        `• Fill phone, city/state, skills, education and experience from the Account tab — then tap Save (both Save & Logout sit together at the bottom).\n` +
        `• Complete profiles get faster recruiter responses and pre-fill your apply emails.`,
    }
  }
  if (/notif|alert|sound|update|bell|message/.test(Q)) {
    return {
      intent,
      text:
        `Notifications 🔔\n` +
        `• The bell icon shows an unread count; every new job, plan update, payment confirmation and platform update lands there.\n` +
        `• New notifications play a chime and are signed by ${CREATOR_PUBLIC}.\n` +
        `• You can mark them read one-by-one or all at once.`,
    }
  }
  if (/pay|upi|razorpay|transaction|utr|receipt|refund|money/.test(Q)) {
    return {
      intent,
      text:
        `Payments 💳\n` +
        `• Choose debit/credit card or UPI (PhonePe, Google Pay or other available apps; QR if offered) inside Razorpay Checkout.\n` +
        `• Never share your PIN/OTP or pay a UPI ID outside checkout. Plans activate only after verified capture.\n` +
        `• If charged but not activated, do not pay again; contact support with the payment ID.\n` +
        `• Issues with a payment? Say "refund" and I'll help you raise a support request (with your permission).`,
    }
  }
  if (/support|ticket|help|issue|problem|complain|not working|error|bug/.test(Q)) {
    return {
      intent,
      text:
        `Sorry to hear that! 🛠\nTell me briefly what's happening. If it needs human eyes, I'll ask your permission and then create a support ticket for the admin — you can track the reply in Tickets.`,
      askTicket: { kind: 'support', subject: 'Support request (from AI Help)' },
    }
  }
  if (/login|register|sign|account|forgot|password reset/.test(Q)) {
    return {
      intent,
      text:
        `Account access 🔑\n` +
        `• New user? Tap "Create account" on the login screen (name, email, mobile, password).\n` +
        `• Forgot password? Use "Reset password" on the login screen.\n` +
        `• For your security I can never see or share account passwords.`,
    }
  }
  if (/creator|owner|divakar|who made|who created|about/.test(Q)) {
    return {
      intent,
      text:
        `About 📌\nMedRep Connect Pro — India's first pharma-job network (MR vacancies first, then multi-industry jobs) — is created by ${CREATOR_PUBLIC}.\n\n` +
        `For support, use this AI Help tab or the Tickets section — admin contact details are never shared publicly for privacy & security.`,
    }
  }

  // Fallback for app-ish but unmatched questions → ask permission for a ticket
  return {
    intent: 'app',
    text:
      `I want to make sure you get the right help 👍\n\n` +
      `I can answer anything about this app — jobs, plans, applying, subscriptions, payments, profile, notifications.\n\n` +
      `If your question needs the admin, say "yes" and I'll ask your permission to create a support ticket.`,
    askTicket: { kind: 'support', subject: 'Support request (from AI Help)' },
  }
}

/** Always run bot text through the secret scrubber before display. */
export function safeReply(text: string): string {
  return sanitizeSecrets(text)
}

export const TICKET_ASK = {
  yes: 'Yes, create ticket',
  no: 'No, thanks',
}

export function ticketCreatedMsg(kind: 'support' | 'refund', id: string): string {
  const num = id.slice(-5).toUpperCase()
  return kind === 'refund'
    ? `✅ Refund request #${num} is open. We sent the reason, your payment details and your account details to the administrator. Track it under Account → My requests.`
    : `✅ Support request #${num} is open. The administrator will reply in Account → My requests.`
}
