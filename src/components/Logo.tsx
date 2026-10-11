export function Logo({ size = 40 }: { size?: number }) {
  return (
    <div
      className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-md shadow-brand-600/30"
      style={{ width: size, height: size }}
      aria-label="MedRep Connect Pro"
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v1H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2V5a3 3 0 0 0-3-3z" />
        <path d="M10 12h4M12 10v4" />
      </svg>
    </div>
  )
}

export function Wordmark({ size = 'text-lg' }: { size?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Logo size={32} />
      <div className="leading-tight">
        <div className={`font-extrabold text-slate-900 ${size}`}>MedRep <span className="text-brand-600">Connect</span></div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pro · Pharma & Jobs Hub</div>
      </div>
    </div>
  )
}
