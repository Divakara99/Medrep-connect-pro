import { ContentPage } from '../components/ContentPage'
import { Logo } from '../components/Logo'
import { Button } from '../components/ui'
import { CREATOR } from '../data/creator'
import { APP_BUILD_LABEL, APP_VERSION_LABEL } from '../data/version'

/**
 * About MedRep Connect Pro — the founder and the product, as their own page.
 *
 * The Account card stays short (mark, tagline, who operates it, contact);
 * the paragraphs behind it live here, where they can be read without being
 * squeezed into a sheet.
 */
export function AboutPage({ onClose }: { onClose: () => void }) {
  return (
    <ContentPage
      title="About MedRep Connect Pro"
      subtitle={CREATOR.tagline}
      onClose={onClose}
      footer={<Button className="w-full" onClick={onClose}>Back to account</Button>}
    >
      <div className="space-y-4 text-sm leading-relaxed text-slate-800">
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex items-center gap-3">
            <Logo size={44} />
            <div className="min-w-0">
              <div className="text-base font-extrabold text-slate-900">MedRep Connect Pro</div>
              <div className="text-xs font-semibold text-brand-700">{CREATOR.title}</div>
            </div>
          </div>
          <p className="mt-3">
            A job network built for field sales hiring in India. Pharma representative (MR) vacancies are pinned
            first because that is where the network started, and every other industry that hires field staff is
            welcome next to them.
          </p>
          <p className="mt-2">
            The product is deliberately narrow: verified vacancies, a clean way to reach the hiring manager, and
            nothing that wastes a candidate's data pack. It works on the website at medrepconnect.in and as an
            Android app on Google Play.
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-bold text-slate-900">Who runs it</h2>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Founder</dt>
              <dd className="font-semibold text-slate-900">{CREATOR.owner}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Role</dt>
              <dd className="font-semibold text-slate-900">{CREATOR.role}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Based in</dt>
              <dd className="font-semibold text-slate-900">{CREATOR.location}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Contact</dt>
              <dd>
                <a className="font-semibold text-blue-600 underline underline-offset-2" href={`mailto:${CREATOR.contactEmail}`}>
                  {CREATOR.contactEmail}
                </a>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Support, refunds and account questions reach the same inbox. Messages sent through the app's own
            support flow are tracked with a ticket number.
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-bold text-slate-900">This build</h2>
          <p className="mt-1 text-sm text-slate-700">
            Version <span className="font-semibold">{APP_VERSION_LABEL}</span> · build{' '}
            <span className="font-mono text-xs">{APP_BUILD_LABEL}</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Contact details shown in a vacancy are the hiring manager's, shared for the job search only. Nobody at
            MedRep Connect Pro will ever ask for your bank PIN, UPI PIN, OTP or card number.
          </p>
        </section>
      </div>
    </ContentPage>
  )
}
