import { useEffect, useRef, useState } from 'react'
import type { Job } from '../data/jobs'
import { shareJob } from '../data/jobShare'
import { Button } from './ui'

type Notice = 'shared' | 'whatsapp' | 'copied' | 'failed' | null

/** The Android share glyph: three dots joined by lines. */
function ShareGlyph({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="m8.3 10.7 7.4-4.3" />
      <path d="m8.3 13.3 7.4 4.3" />
    </svg>
  )
}

/**
 * Share a vacancy with a friend.
 *
 * Tapping it opens the phone's share sheet straight away — WhatsApp, Messages,
 * Gmail, anything installed. The website uses Web Share, and a desktop browser
 * without it opens WhatsApp directly. Open to everyone: a free user can pass a
 * job on without buying anything, and the message never carries the company
 * name, manager name, email or phone numbers (see `shareJobText`).
 *
 * `icon` is the compact circle used on a job card; the default is the full
 * button used on the job page.
 */
export function ShareJobButton({
  job,
  variant = 'secondary',
  className = '',
  icon = false,
}: {
  job: Job
  variant?: 'primary' | 'secondary' | 'ghost'
  className?: string
  icon?: boolean
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
      setNotice(result)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setNotice(null), 2600)
    } finally {
      setBusy(false)
    }
  }

  if (icon) {
    return (
      <button
        type="button"
        onClick={onShare}
        disabled={busy}
        aria-label="Share this vacancy on WhatsApp or another app"
        title="Share this vacancy"
        className={`grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200 hover:text-slate-900 active:scale-95 disabled:opacity-60 ${className}`}
      >
        <ShareGlyph />
      </button>
    )
  }

  return (
    <div className="w-full">
      <Button
        variant={variant}
        className={`w-full ${className}`}
        onClick={onShare}
        disabled={busy}
        aria-label="Share this vacancy on WhatsApp or another app"
      >
        <ShareGlyph />
        <span>{notice === 'copied' ? 'Copied — paste it anywhere' : 'Share this vacancy'}</span>
      </Button>
      {(notice === 'shared' || notice === 'whatsapp') && (
        <p className="mt-1.5 text-center text-xs font-semibold text-emerald-700">
          {notice === 'whatsapp'
            ? 'Opened WhatsApp — send the message there.'
            : 'Shared — the contact details stay in the app.'}
        </p>
      )}
      {notice === 'failed' && (
        <p className="mt-1.5 text-center text-xs font-semibold text-rose-600">
          Could not open a sharing app on this device. Try again from your phone.
        </p>
      )}
    </div>
  )
}
