import { ContentPage } from '../components/ContentPage'
import { Button } from '../components/ui'

/**
 * "Earlier direct UPI transfer" — the explanation that used to sit as a
 * paragraph inside the passes page form.
 *
 * Reading belongs on a page; the form stays on the passes screen with only its
 * labels. Nothing here takes a payment: it explains the bank reference an
 * admin must verify for a transfer made before direct UPI was retired.
 */
export function LegacyUpiPage({ onClose }: { onClose: () => void }) {
  return (
    <ContentPage
      title="Earlier direct UPI transfer"
      subtitle="Only for a transfer you already made"
      onClose={onClose}
      footer={<Button className="w-full" onClick={onClose}>Back to passes</Button>}
    >
      <div className="space-y-3 text-sm leading-relaxed text-slate-800">
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">Who this is for</h2>
          <p className="mt-1.5">
            This is only for a manual UPI request you already created on the platform and paid from your bank app.
            It is not a way to start a new payment.
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">What to enter</h2>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>Choose the existing request it belongs to.</li>
            <li>
              Enter the UTR (the reference number your bank or UPI app gives after the transfer). It is usually 12
              digits and appears in the transfer details, not on the request screen.
            </li>
            <li>Submit it once. Sending the same reference twice does not speed anything up.</li>
          </ul>
        </section>

        <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <h2 className="font-bold text-amber-950">Do not make a new direct transfer</h2>
          <p className="mt-1.5 text-amber-900">
            A fresh transfer to a UPI ID you were given elsewhere cannot be matched to your account automatically.
            Every brand-new pass payment is made inside Razorpay Checkout on the passes page, which activates as soon
            as the payment is verified.
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">What happens after you submit</h2>
          <p className="mt-1.5">
            An administrator checks the bank credit against your reference. Access activates only after that check
            passes; until then the pass stays pending and the contact details stay locked.
          </p>
        </section>
      </div>
    </ContentPage>
  )
}
