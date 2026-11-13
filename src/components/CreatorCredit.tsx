import { CREATOR } from '../data/creator'

export function CreatorCredit({ variant = 'light', size = 'md', compact = false }: { variant?: 'light' | 'dark' | 'solid'; size?: 'sm' | 'md'; compact?: boolean }) {
  const styles = {
    light: 'bg-gradient-to-r from-amber-50 to-amber-100/40 text-amber-900 ring-1 ring-amber-200',
    dark: 'bg-white/10 text-white ring-1 ring-white/20 backdrop-blur',
    solid: 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30',
  } as const
  const sz = size === 'sm' ? 'px-2.5 py-1 text-[10px] gap-1.5' : 'px-3.5 py-1.5 text-xs gap-2'
  if (compact) {
    return (
      <div
        title={`App created by Mr. ${CREATOR.name} · ${CREATOR.role}`}
        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-1 text-[9px] font-extrabold leading-none ${styles[variant]}`}
      >
        <span aria-hidden="true" className="text-[10px]">👤</span>
        <span>Mr. {CREATOR.name}</span>
      </div>
    )
  }
  return (
    <div className={`inline-flex items-center rounded-full font-semibold ${styles[variant]} ${sz}`}>
      <span className="leading-none">👤</span>
      <span className="uppercase tracking-wider opacity-80" style={{ fontSize: size === 'sm' ? '10px' : '11px' }}>App created by</span>
      <span className="font-extrabold tracking-wide">Mr. {CREATOR.name}</span>
      <span className="opacity-70 hidden sm:inline">·</span>
      <span className="font-medium hidden sm:inline">{CREATOR.role}</span>
    </div>
  )
}
