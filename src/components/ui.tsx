import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useBackHandler } from './useBackHandler'

/**
 * The shared surface language.
 *
 * Every screen draws from these primitives, so the app keeps one look: soft
 * white sheets on the coloured page wash, one deep shadow for things that
 * float, gradients only on primary actions and the hero. Sizes stay generous
 * for thumbs on a phone and for the tablet the app is mostly used on.
 */

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
}) {
  const base =
    'inline-flex min-w-0 max-w-full select-none items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-center text-base font-bold leading-snug whitespace-normal break-words transition-[transform,background-color,box-shadow,border-color] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50'
  const styles: Record<string, string> = {
    primary:
      'bg-gradient-to-b from-brand-500 to-brand-700 text-white ring-1 ring-brand-700/30 shadow-[0_12px_26px_-14px_rgba(29,78,216,0.95)] hover:to-brand-800',
    // Every button carries its own surface colour. A white button on a white
    // card reads as plain text — the user asked for a background that matches
    // the product, so the quiet variants are tinted rather than blank.
    secondary:
      'bg-brand-50 text-brand-800 ring-1 ring-brand-200 shadow-[0_6px_18px_-16px_rgba(29,78,216,0.7)] hover:bg-brand-100 hover:ring-brand-300',
    ghost:
      'bg-slate-100 text-slate-700 ring-1 ring-slate-200/80 hover:bg-slate-200 hover:text-slate-900',
    danger:
      'bg-gradient-to-b from-rose-500 to-rose-600 text-white ring-1 ring-rose-700/30 shadow-[0_12px_26px_-16px_rgba(225,29,72,0.9)] hover:to-rose-700',
    accent:
      'bg-gradient-to-b from-amber-400 to-orange-500 text-slate-950 ring-1 ring-orange-600/30 shadow-[0_12px_26px_-16px_rgba(234,88,12,0.9)] hover:to-orange-600',
  }
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...rest}>
      {children}
    </button>
  )
}

const FIELD =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD} ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} text-sm ${props.className ?? ''}`} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD} ${props.className ?? ''}`} />
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-bold tracking-wide text-slate-700">
      {children}
    </label>
  )
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-3xl border border-slate-200/80 bg-white/95 shadow-[0_18px_44px_-32px_rgba(15,23,42,0.6)] ${className}`}
    >
      {children}
    </div>
  )
}

export function Badge({ children, color = 'slate' }: { children: ReactNode; color?: 'slate' | 'brand' | 'amber' | 'green' | 'red' | 'purple' }) {
  const map: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
    brand: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
    amber: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
    green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    red: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    purple: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  }
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-center text-xs font-bold whitespace-normal break-words leading-snug ${map[color]}`}>
      {children}
    </span>
  )
}

/**
 * The one back control used on every standalone page, so "how do I get out of
 * this screen" always looks the same and sits in the same corner.
 */
export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-200 hover:ring-slate-300 active:scale-95"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      Back
    </button>
  )
}

export function Modal({ open, onClose, children, title, onBack }: { open: boolean; onClose: () => void; children: ReactNode; title?: string; onBack?: () => void }) {
  // The phone's back button closes the open sheet (page → sheet → page) instead
  // of leaving the app.
  useBackHandler(open, onClose)
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[2px] animate-fade-in sm:items-center sm:p-4"
      // Sheets rise from the bottom edge, which is exactly where the native
      // ads banner sits. --ad-reserve lifts the panel above it so the last row
      // of buttons (Watch video, Apply, Cancel) stays tappable. Zero on the
      // website and on tabs where no banner is shown.
      style={{ paddingBottom: 'var(--ad-reserve, 0px)' }}
      onClick={onClose}
    >
      <div
        className="hairline flex max-h-[90vh] w-full flex-col overflow-y-auto rounded-t-[28px] bg-white shadow-[0_-10px_60px_-12px_rgba(15,23,42,0.45)] sm:max-w-lg sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
            <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-200 sm:hidden" />
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                title="Back"
                className="-ml-2 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-600 transition hover:bg-slate-100"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}
            <h3 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-900">{title}</h3>
            <button
              type="button"
              aria-label="Close"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, subtitle }: { icon?: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      {icon && (
        <div className="mb-3 grid h-16 w-16 place-items-center rounded-3xl bg-brand-50 text-4xl ring-1 ring-brand-100">{icon}</div>
      )}
      <div className="font-semibold text-slate-800">{title}</div>
      {subtitle && <div className="mt-1 max-w-xs text-sm text-slate-500">{subtitle}</div>}
    </div>
  )
}

export function TopBar({ title, right, left }: { title?: ReactNode; right?: ReactNode; left?: ReactNode }) {
  return (
    <div className="glass-bar sticky top-0 z-20 border-b border-white/60 shadow-[0_10px_30px_-26px_rgba(15,23,42,0.75)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">{left}</div>
        {title !== undefined && (
          <div className="hidden shrink-0 truncate text-base font-bold text-slate-900 sm:block">{title}</div>
        )}
        <div className="flex flex-1 items-center justify-end gap-2">{right}</div>
      </div>
    </div>
  )
}
