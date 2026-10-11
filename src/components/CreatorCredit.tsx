import { CREATOR } from '../data/creator'

export function CreatorCredit({ variant = 'light', size = 'md' }: { variant?: 'light' | 'dark' | 'solid'; size?: 'sm' | 'md' }) {
  const styles = {
    light: 'bg-gradient-to-r from-amber-50 to-amber-100/40 text-amber-900 ring-1 ring-amber-200',
    dark: 'bg-white/10 text-white ring-1 ring-white/20 backdrop-blur',
    solid: 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30',
  } as const
  const sz = size === 'sm' ? 'px-2 py-0.5 text-[10px] gap-1' : 'px-3 py-1.5 text-xs gap-2'
  return (
    <div className={`inline-flex items-center rounded-full font-semibold ${styles[variant]} ${sz}`}>
      <span className="leading-none">👤</span>
      <span className="uppercase tracking-wider opacity-80" style={{ fontSize: size === 'sm' ? '8px' : '10px' }}>App created by</span>
      <span className="font-extrabold tracking-wide">Mr. {CREATOR.name}</span>
      <span className="opacity-70 hidden sm:inline">·</span>
      <span className="font-medium hidden sm:inline">{CREATOR.role}</span>
    </div>
  )
}
