import { ContentPage } from '../components/ContentPage'
import { Button } from '../components/ui'
import { CREATOR } from '../data/creator'
import { JOB_UNLOCK_PRICE_RUPEES } from '../data/jobUnlock'
import { UNLOCK_WINDOW_MINUTES } from '../data/unlockWindow'

/**
 * "Help & how it works" — the plain-language rules of the app, on one page.
 *
 * Every sentence here matches what the code actually does; if a rule changes
 * (a window, a price, what a pass covers), change it here too. Nothing on this
 * page sells anything: the numbers are stated the way a support answer would
 * state them.
 */
export function HelpPage({ onClose }: { onClose: () => void }) {
  return (
    <ContentPage
      title="Help & how it works"
      subtitle="Short answers to what people ask most"
      onClose={onClose}
      footer={<Button className="w-full" onClick={onClose}>Back to account</Button>}
    >
      <div className="space-y-3 text-sm leading-relaxed text-slate-800">
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">What is visible without paying</h2>
          <p className="mt-1.5">
            Role, city, HQ, division, salary, experience, qualification, age limit, vacancy count, the posted date
            and the full job description. Nobody has to pay to read what a job is.
          </p>
          <p className="mt-2">
            Five details stay private: the company name, the hiring manager's name, the manager's email, the
            ABM/ASM number and the alternate number. They are the manager's, not the platform's.
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">Ways to open a contact</h2>
          <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-semibold">A pass</span> opens every vacancy's contact details while it runs, and
              enables Apply. One payment, no auto-renew; buying again adds days to the expiry.
            </li>
            <li>
              <span className="font-semibold">A short video</span> (Android app) opens the company name for one job
              for {UNLOCK_WINDOW_MINUTES} minutes, free. Watching again reopens it.
            </li>
            <li>
              <span className="font-semibold">₹{JOB_UNLOCK_PRICE_RUPEES} for one job</span> (website) opens that
              vacancy's full contact block and keeps it open for that job. One payment. Nothing renews.
            </li>
          </ul>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">Applying</h2>
          <p className="mt-1.5">
            Complete your profile first — name, phone, city, education and a short bio. Date of birth, gender,
            expected CTC, notice period and a resume are optional. An application goes to the hiring manager by
            email, or by WhatsApp when no email is on file, and is saved under Account → My applications.
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">Payments</h2>
          <p className="mt-1.5">
            On the website, passes are paid through Razorpay or UPI. In the Android app, passes are paid through
            Google Play, which shows its own price and currency. A pass starts only after the server verifies the
            payment — never from the phone alone.
          </p>
          <p className="mt-2">
            Charged but not activated, or want a refund? Open Account → My requests and send the payment ID. Never
            pay twice for the same plan.
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-bold text-slate-900">Privacy and safety</h2>
          <p className="mt-1.5">
            Contact details are sent to a phone only after a pass, a video or a paid unlock — the database decides
            that on every read, not the screen. Nobody from MedRep Connect Pro will ask for an OTP, UPI PIN, bank
            PIN or card number.
          </p>
          <p className="mt-2">
            Still stuck? Write to{' '}
            <a className="font-semibold text-blue-600 underline underline-offset-2" href={`mailto:${CREATOR.contactEmail}`}>
              {CREATOR.contactEmail}
            </a>{' '}
            or use the AI Help tab for the same answers in a chat.
          </p>
        </section>
      </div>
    </ContentPage>
  )
}
