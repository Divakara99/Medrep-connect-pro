import { THRESHOLD } from './pullToRefreshThreshold'

/**
 * The indicator itself. Fixed to the top of the viewport because the gesture can
 * start on any screen that scrolls as a whole document.
 */
export function PullToRefreshIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  if (pull <= 0) return null
  const ready = pull >= THRESHOLD
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
      style={{ transform: `translateY(${Math.min(pull, 72)}px)` }}
      data-pull-to-refresh={refreshing ? 'refreshing' : ready ? 'release' : 'pull'}
    >
      <div className="flex items-center gap-2 rounded-full bg-slate-900/90 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg">
        <span
          className={refreshing ? 'animate-spin' : ''}
          style={{ transform: refreshing ? undefined : `rotate(${ready ? 180 : 0}deg)` }}
          aria-hidden
        >
          {refreshing ? '⟳' : '↓'}
        </span>
        {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
      </div>
    </div>
  )
}
