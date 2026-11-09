import { useEffect, useRef, useState } from 'react'
import type { Job } from '../data/jobs'
import { shareJob } from '../data/jobShare'
import { Button } from './ui'

type Notice = 'shared' | 'copied' | 'failed' | null

/**
 * Share a vacancy with a friend.
 *
 * Open to everyone: a free user can pass a job on without buying anything. The
 * message carries the public details and the Play Store link, never the
 * company name, manager name, email or phone numbers — see `shareJobText`.
 */
export function ShareJobButton({
  job,
  variant = 'secondary',
  className = '',
  compact = false,
}: {
  job: Job
  variant?: 'primary' | 'secondary' | 'ghost'
  className?: string
  compact?: boolean
}) {
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  async function onShare() {
    if (busy) return
    setBusy(true)
    try {
      const result = await shareJob(job)
      if (result === 'cancelled') return
      setNotice(result === 'failed' ? 'failed' : result === 'copied' ? 'copied' : 'shared')
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setNotice(null), 3200)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={compact ? 'shrink-0' : 'w-full'}>
      <Button
        variant={variant}
        className={`${compact ? 'px-3 py-2' : 'w-full'} ${className}`}
        onClick={onShare}
        disabled={busy}
        aria-label="Share this vacancy"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3v12" />
          <path d="m7.5 7.5 4.5-4.5 4.5 4.5" />
          <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
        {!compact && <span>{notice === 'copied' ? 'Copied — paste it anywhere' : 'Share this vacancy'}</span>}
      </Button>
      {notice === 'shared' && !compact && (
        <p className="mt-1.5 text-center text-xs font-semibold text-emerald-700">
          Shared — the contact details stay in the app.
        </p>
      )}
      {notice === 'copied' && compact && (
        <p className="mt-1 text-[11px] font-semibold text-emerald-700">Copied</p>
      )}
      {notice === 'failed' && (
        <p className={`mt-1.5 text-xs font-semibold text-rose-600 ${compact ? 'text-[11px]' : 'text-center'}`}>
          Could not share on this device. Open the vacancy and try again.
        </p>
      )}
    </div>
  )
}
