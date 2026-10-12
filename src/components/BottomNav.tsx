export type UserTab = 'home' | 'priority' | 'plans' | 'applications' | 'ai' | 'account'

const TABS: { id: UserTab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'priority', label: 'Priority', icon: '⭐' },
  { id: 'plans', label: 'Plans', icon: '💎' },
  { id: 'applications', label: 'Resume', icon: '📎' },
  { id: 'ai', label: 'AI Help', icon: '🤖' },
  { id: 'account', label: 'Account', icon: '👤' },
]

export function BottomNav({ active, onChange }: { active: UserTab; onChange: (t: UserTab) => void }) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200">
      <div className="max-w-3xl mx-auto grid grid-cols-6">
        {TABS.map((t) => {
          const isActive = active === t.id
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition ${isActive ? 'text-brand-600' : 'text-slate-500'}`}
            >
              <span className={`text-lg leading-none ${isActive ? 'scale-110' : ''}`}>{t.icon}</span>
              <span>{t.label}</span>
              {isActive && <span className="h-1 w-5 rounded-full bg-brand-600 mt-0.5" />}
            </button>
          )
        })}
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </nav>
  )
}
