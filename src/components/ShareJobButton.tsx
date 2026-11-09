import { useEffect, useRef, useState } from 'react'
import type { Job } from '../data/jobs'
import { isNativeApp } from '../data/platform'
import { shareJob, shareJobByMessage, shareJobText, whatsappShareUrl } from '../data/jobShare'

type Notice = 'shared' | 'whatsapp' | 'messages' | 'blocked' | 'failed' | null

const FULL_BUTTON = 'inline-flex w-full select-none items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-base font-bold transition-[transform,background-color,box-shadow,border-color] duration-200 active:scale-[0.97]'
const SECONDARY = 'bg-brand-50 text-brand-800 ring-1 ring-brand-200 shadow-[0_6px_18px_-16px_rgba(29,78,216,0.7)] hover:bg-brand-100 hover:ring-brand-300'
const ICON_BUTTON = 'grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200 hover:text-slate-900 active:scale-95'

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
  className = '',
  icon = false,
}: {
  job: Job
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
      // WhatsApp or the system chooser first; if neither could open, fall
      // straight through to the Messages app. The text is never copied.
      let result = await shareJob(job)
      if (result === 'failed') result = shareJobByMessage(job)
      if (result === 'cancelled') return
      setNotice(result)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setNotice(null), 2600)
    } finally {
      setBusy(false)
    }
  }

  // On the web the control is a real link to WhatsApp: clicking an anchor is
  // never treated as a popup, so it opens even where a scripted window.open is
  // blocked. On a phone with the system share sheet, that sheet is used first.
  const webHref = whatsappShareUrl(shareJobText(job))
  const native = isNativeApp()

  function onWebClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return
    event.preventDefault()
    void onShare()
  }

  if (icon) {
    if (native) {
      return (
        <button
          type="button"
          onClick={onShare}
          disabled={busy}
          aria-label="Share this vacancy on WhatsApp or another app"
          title="Share this vacancy"
          className={`${ICON_BUTTON} ${className}`}
        >
          <ShareGlyph />
        </button>
      )
    }
    return (
      <a
        href={webHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onWebClick}
        aria-label="Share this vacancy on WhatsApp or another app"
        title="Share this vacancy"
        className={`${ICON_BUTTON} ${className}`}
      >
        <ShareGlyph />
      </a>
    )
  }

  return (
    <div className="w-full">
      {native ? (
        <button
          type="button"
          onClick={onShare}
          disabled={busy}
          className={`${FULL_BUTTON} ${SECONDARY} ${className}`}
          aria-label="Share this vacancy on WhatsApp or another app"
        >
          <ShareGlyph />
          <span>Share this vacancy</span>
        </button>
      ) : (
        <a
          href={webHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onWebClick}
          className={`${FULL_BUTTON} ${SECONDARY} ${className}`}
          aria-label="Share this vacancy on WhatsApp or another app"
        >
          <ShareGlyph />
          <span>Share this vacancy</span>
        </a>
      )}
      {(notice === 'shared' || notice === 'whatsapp' || notice === 'messages') && (
        <p className="mt-1.5 text-center text-xs font-semibold text-emerald-700">
          {notice === 'whatsapp'
            ? 'Opened WhatsApp — send the message there.'
            : notice === 'messages'
              ? 'Opened your Messages app — send the message there.'
              : 'Shared — nobody gets the contact details, only the vacancy.'}
        </p>
      )}
      {notice === 'blocked' && (
        <p className="mt-1.5 text-center text-xs font-semibold text-slate-600">
          Your browser blocked the new tab.{' '}
          <a href={webHref} target="_blank" rel="noopener noreferrer" className="font-bold text-brand-700 underline">
            Open WhatsApp
          </a>{' '}
          to send it.
        </p>
      )}
      {notice === 'failed' && (
        <p className="mt-1.5 text-center text-xs font-semibold text-rose-600">
          No sharing app could be opened on this device. Try again from the phone.
        </p>
      )}
    </div>
  )
}
