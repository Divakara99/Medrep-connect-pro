// Sharing a vacancy from the device.
//
// Order of preference: the Android share sheet (every messaging app the phone
// has), then the browser's Web Share API, then "copy the text" so the user can
// paste it anywhere. All three carry the same message from `shareJobText`, which
// never contains contact information.

import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { SHARE_TITLE, shareJobText, type ShareableVacancy } from './jobShareText'

export { PLAY_STORE_URL, SHARE_TITLE, shareJobText } from './jobShareText'
export type { ShareableVacancy } from './jobShareText'

export type ShareResult = 'shared' | 'whatsapp' | 'copied' | 'cancelled' | 'failed'

/** WhatsApp's own share entry point, used when the device has no share sheet. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** Copy text without the async Clipboard API, for older WebViews. */
function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path.
  }
  return legacyCopy(text)
}

/**
 * Open the share sheet for a vacancy.
 *
 * `cancelled` means the user closed the sheet — never an error to report.
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
      // A dismissed sheet is not a failure; anything else falls back to copying.
      const message = error instanceof Error ? error.message : String(error ?? '')
      if (/cancel/i.test(message)) return 'cancelled'
    }
  } else if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    // Phones and Safari: the same chooser the app shows.
    try {
      await navigator.share({ title: SHARE_TITLE, text })
      return 'shared'
    } catch (error) {
      const message = error instanceof Error ? error.name + ' ' + error.message : String(error ?? '')
      if (/abort|cancel/i.test(message)) return 'cancelled'
    }
  }

  // Desktop browsers without Web Share: go straight to WhatsApp instead of
  // making the person copy and paste.
  if (typeof window !== 'undefined') {
    const opened = window.open(whatsappShareUrl(text), '_blank', 'noopener,noreferrer')
    if (opened) return 'whatsapp'
  }

  return (await copyText(text)) ? 'copied' : 'failed'
}
