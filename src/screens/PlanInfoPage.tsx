import { useState } from 'react'
import { ContentPage } from '../components/ContentPage'
import { Badge, Button } from '../components/ui'
import { CREATOR } from '../data/creator'
import { TermsPage } from './TermsPage'

/**
 * "Plan benefits, payments & terms" — the reading that used to sit as three
 * long cards under the price boxes.
 *
 * The passes page is for choosing; this page is for reading. Small decision
 * sheets are untouched, and the full terms are one more step from here.
 */
export function PlanInfoPage({ inApp, onClose }: { inApp: boolean; onClose: () => void }) {
  const [showTerms, setShowTerms] = useState(false)
  if (showTerms) return <TermsPage onClose={() => setShowTerms(false)} backLabel="Back to plan details" />

  return (
    <ContentPage
      title="Plan benefits, payments & terms"
      subtitle={inApp ? 'Google Play Billing' : 'Razorpay Checkout only'}
      onClose={onClose}
      footer={<Button className="w-full" onClick={onClose}>Back to passes</Button>}
    >
      <div className="space-y-3 text-sm leading-relaxed text-slate-800">
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">Plan benefits</h2>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>Full company name, manager and contact number for every job</li>
            <li>One-tap Apply with confirmation</li>
            <li>Priority job alerts and pinned jobs</li>
            <li>AI chat help and support tickets</li>
          </ul>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-slate-900">How payment works</h2>
            <Badge color="slate">{inApp ? 'Google Play Billing' : 'Razorpay Checkout only'}</Badge>
          </div>
          {inApp ? (
            <p className="mt-1.5">
              Every plan is a one-time Google Play pass for the number of days shown. Google Play handles the payment
              with the method on your Play account, and your access starts once our server verifies the purchase with
              Google. Renewing buys the pass again and adds its days to your current expiry.
            </p>
          ) : (
            <p className="mt-1.5">
              Every plan is paid inside secure Razorpay Checkout, using whichever methods the merchant account has
              enabled — credit/debit cards, netbanking, and UPI apps such as PhonePe, Google Pay or Paytm, plus a
              Razorpay QR where offered. We never ask you to transfer money to a personal UPI ID or bank account, and
              merchant banking details are never shown in the app.
            </p>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">When a pass ends</h2>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>Your pass covers the number of days shown, counted from the moment the server confirms the payment.</li>
            <li>
              When those days run out, the company name, manager name, email and phone numbers lock again. Vacancy
              titles, city, HQ, salary, experience and descriptions stay visible to everyone, free.
            </li>
            <li>
              Nothing is charged automatically and no plan renews by itself. Buying again adds its days to an active
              pass, or starts a fresh one if the old pass already ended.
            </li>
            <li>
              The ₹5 job unlock is separate: it opens that one job's full contacts for 24 hours. All-jobs passes remain
              active for the duration shown on the selected plan.
            </li>
          </ul>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">Instructions & standard terms</h2>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {inApp ? (
              <>
                <li>Pay only through Google Play Billing inside this app. No other payment channel is offered.</li>
                <li>Access starts after Google Play confirms the purchase and our server verifies it.</li>
              </>
            ) : (
              <>
                <li>Pay only inside Razorpay Checkout. No other payment channel is offered.</li>
                <li>Access starts after the payment is verified by the server (Razorpay capture confirmed before your plan unlocks).</li>
              </>
            )}
            <li>One plan per payment. Renewals add days to your existing expiry.</li>
            <li>Do not share your bank PIN, OTP or passwords with anyone, including support.</li>
            <li>
              Questions about a payment? Email{' '}
              <a href={`mailto:${CREATOR.contactEmail}`} className="font-semibold text-blue-600 underline underline-offset-2">
                {CREATOR.contactEmail}
              </a>.
            </li>
            <li>
              By continuing you agree to the MedRep Connect Pro terms and conditions.{' '}
              <button
                type="button"
                onClick={() => setShowTerms(true)}
                className="font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-800"
              >
                Read the full terms
              </button>.
            </li>
          </ul>
        </section>
      </div>
    </ContentPage>
  )
}
