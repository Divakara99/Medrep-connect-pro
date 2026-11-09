import { ContentPage } from '../components/ContentPage'
import { Button } from '../components/ui'
import { TERMS_LAST_UPDATED, TERMS_SECTIONS } from '../data/terms'

/**
 * Terms and conditions as their own page.
 *
 * They used to open inside a bottom sheet, which is the wrong shape for several
 * pages of legal text: the reader had to scroll a small box with a Close button
 * pinned below it. Here the text gets the whole screen, a back arrow that means
 * "back", and the phone's back gesture for free.
 */
export function TermsPage({ onClose, backLabel = 'Back to passes' }: { onClose: () => void; backLabel?: string }) {
  return (
    <ContentPage
      title="Terms and conditions"
      subtitle={`Last updated ${TERMS_LAST_UPDATED}`}
      onClose={onClose}
      footer={<Button className="w-full" onClick={onClose}>{backLabel}</Button>}
    >
      <div className="space-y-4 text-sm leading-relaxed text-slate-800">
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
          Draft — final wording is pending owner approval. Items in [square brackets] are completed before publication.
        </p>
        <p className="text-xs text-slate-500">These terms apply to every MedRep Connect Pro user.</p>
        {TERMS_SECTIONS.map((section, index) => (
          <section key={section.title} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="font-bold text-slate-900">{index + 1}. {section.title}</h2>
            <div className="mt-1.5 space-y-2">
              {section.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </ContentPage>
  )
}
