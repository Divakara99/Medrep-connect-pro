// Sharing a vacancy — always into a messaging app, never into the clipboard.
//
// Order of preference:
//   1. the Android share sheet, which lists WhatsApp, Messages, Gmail and every
//      other installed app;
//   2. the browser's Web Share API, which shows the same sheet on a phone;
//   3. WhatsApp's own share link (WhatsApp Web on a desktop);
//   4. the phone's Messages app over an sms: link, if WhatsApp cannot be opened.
//
// There is deliberately no "copy the text" path: the person tapping Share asked
// to send the vacancy, so the app opens something they can send it with. The
// message itself comes from `shareJobText`, which never contains the company
// name, manager name, email or phone numbers.

import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { SHARE_TITLE, shareJobText, type ShareableVacancy } from './jobShareText'

export { PLAY_STORE_URL, SHARE_TITLE, shareJobText } from './jobShareText'
export type { ShareableVacancy } from './jobShareText'

export type ShareResult = 'shared' | 'whatsapp' | 'messages' | 'cancelled' | 'failed'

/** WhatsApp's own share entry point — works on a phone and in WhatsApp Web. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** The phone's Messages app, for anyone who does not use WhatsApp. */
export function smsShareUrl(text: string): string {
  return `sms:?&body=${encodeURIComponent(text)}`
}

/**
 * Send the reader somewhere they can actually share: try a new tab first (so
 * the app stays open behind it), then this tab if the popup was blocked.
 * Returns false only when neither could be attempted.
 */
function openExternal(url: string): boolean {
  if (typeof window === 'undefined') return false
  // Inside the Android app the WebView must not navigate itself: `_system`
  // hands the link to the phone, which opens WhatsApp or Messages properly.
  if (Capacitor.isNativePlatform()) {
    try {
      window.open(url, '_system')
      return true
    } catch {
      return false
    }
  }
  try {
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (opened) return true
  } catch {
    // Popup blocked — fall through to navigating this tab.
  }
  try {
    window.location.href = url
    return true
  } catch {
    return false
  }
}

/**
 * Open a sharing app for this vacancy.
 *
 * Never copies the message: a copy leaves the person with text and no app, and
 * they asked to share. `cancelled` means they closed the sheet, which is not an
 * error to report.
 */
export async function shareJob(job: ShareableVacancy): Promise<ShareResult> {
  const text = shareJobText(job)

  // Android: the system chooser, listing WhatsApp, Messages and every other app
  // on the phone. This is the path the app always takes.
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title: SHARE_TITLE, text, dialogTitle: 'Share this vacancy' })
      return 'shared'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '')
      if (/cancel/i.test(message)) return 'cancelled'
      // The chooser could not open: hand the message to WhatsApp instead.
      return openExternal(whatsappShareUrl(text)) ? 'whatsapp' : 'failed'
    }
  }

  // A phone browser (and Safari): the same sheet as the app.
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: SHARE_TITLE, text })
      return 'shared'
    } catch (error) {
      const message = error instanceof Error ? error.name + ' ' + error.message : String(error ?? '')
      if (/abort|cancel/i.test(message)) return 'cancelled'
    }
  }

  // A desktop browser without Web Share: open WhatsApp directly.
  if (openExternal(whatsappShareUrl(text))) return 'whatsapp'

  return 'failed'
}

/** WhatsApp blocked? Try the phone's Messages app before giving up. */
export function shareJobByMessage(job: ShareableVacancy): ShareResult {
  return openExternal(smsShareUrl(shareJobText(job))) ? 'messages' : 'failed'
}
