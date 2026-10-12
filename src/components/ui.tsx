import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-base font-bold transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none'
  const styles: Record<string, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20',
    secondary: 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-50',
    ghost: 'bg-transparent text-slate-700 hover:bg-slate-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    accent: 'bg-accent-500 text-white hover:bg-accent-600 shadow-sm',
  }
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...rest}>
      {children}
    </button>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-base font-medium text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 ${props.className ?? ''}`}
    />
  )
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 ${props.className ?? ''}`}
    />
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-base font-medium text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 ${props.className ?? ''}`}
    />
  )
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-bold tracking-wide text-slate-700 mb-1.5">
      {children}
    </label>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white border border-slate-200/70 shadow-sm ${className}`}>{children}</div>
}

export function Badge({ children, color = 'slate' }: { children: ReactNode; color?: 'slate' | 'brand' | 'amber' | 'green' | 'red' | 'purple' }) {
  const map: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700',
    brand: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
    amber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    red: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    purple: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${map[color]}`}>{children}</span>
}

export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4 animate-fade-in" onClick={onClose}>
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <button className="text-slate-400 hover:text-slate-700 text-xl leading-none" onClick={onClose}>×</button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, subtitle }: { icon?: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      {icon && <div className="text-4xl mb-3">{icon}</div>}
      <div className="text-slate-800 font-semibold">{title}</div>
      {subtitle && <div className="text-sm text-slate-500 mt-1 max-w-xs">{subtitle}</div>}
    </div>
  )
}

export function TopBar({ title, right, left }: { title?: ReactNode; right?: ReactNode; left?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200/60">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">{left}</div>
        {title !== undefined && (
          <div className="text-base font-bold text-slate-900 truncate flex-shrink-0">{title}</div>
        )}
        <div className="flex items-center gap-2 flex-1 justify-end">{right}</div>
      </div>
    </div>
  )
}

export function IconButton({ children, onClick, badge, className = '', title }: ButtonHTMLAttributes<HTMLButtonElement> & { badge?: number | string; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`relative inline-flex items-center justify-center w-10 h-10 rounded-full bg-white ring-1 ring-slate-200 hover:bg-slate-50 text-lg transition ${className}`}
    >
      {children}
      {badge !== undefined && badge !== 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold grid place-items-center">
          {typeof badge === 'number' && badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}
