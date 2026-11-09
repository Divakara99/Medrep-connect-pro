import type { ReactNode } from 'react'
import { BackButton } from './ui'
import { useBackHandler } from './useBackHandler'

/**
 * A full page for long text — terms, about, help.
 *
 * Paragraphs do not belong in a bottom sheet: a sheet is sized for a question
 * and an answer, and long copy inside one traps the reader between a small
 * scroll area and a Close button. Anything that is meant to be READ opens here
 * instead: its own page, a back arrow in the header, the phone's back button
 * wired to the same exit, and room to scroll.
 *
 * Small interactions that ask for a decision (delete this? send this email?)
 * stay as sheets.
 */
export function ContentPage({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  /** Optional page-level action, e.g. "Accept" — never required to read. */
  footer?: ReactNode
}) {
  // The phone's back gesture must leave this page, not the app.
  useBackHandler(true, onClose)

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-50">
      <header className="glass-bar sticky top-0 z-10 border-b border-white/60">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <BackButton onClick={onClose} label={`Back from ${title}`} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold text-slate-900">{title}</h1>
            {subtitle && <div className="truncate text-xs font-medium text-slate-500">{subtitle}</div>}
          </div>
        </div>
      </header>
      <div
        className="mx-auto max-w-3xl px-4 py-4"
        // Leave the native ads strip its own space at the bottom of the page.
        style={{ paddingBottom: 'calc(1.5rem + var(--ad-reserve, 0px))' }}
      >
        {children}
        {footer && <div className="pt-4">{footer}</div>}
      </div>
    </div>
  )
}
