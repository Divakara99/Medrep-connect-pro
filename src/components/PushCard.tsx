import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card } from './ui'
import {
  disablePush,
  enablePush,
  getPushConfig,
  pushState,
  sendTestPush,
} from '../data/push'
import { pushAvailability, pushAvailabilityMessage, type PushAvailability } from '../data/pushRules'
import { setSoundEnabled, soundEnabled } from '../data/notifications'

/**
 * The "notifications on this phone" card.
 *
 * One place turns Web Push on and off, shows exactly what the state is, and lets
 * the user send themselves a test notification — so "notifications are not
 * working" is never a guess. Nothing is requested until the user taps the
 * button, which is also what browsers require for the permission prompt.
 */
export function PushCard({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushAvailability | 'loading'>('loading')
  const [sound, setSound] = useState(() => soundEnabled())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const refresh = useCallback(async () => {
    const env = await pushState()
    const config = await getPushConfig()
    setState(pushAvailability({ ...env, platformReady: config.configured }))
  }, [])

  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh])

  async function turnOn() {
    setBusy(true)
    setNotice(null)
    const result = await enablePush()
    setBusy(false)
    if (!result.ok) {
      setNotice({ kind: 'error', text: result.error })
      await refresh()
      return
    }
    setNotice({ kind: 'ok', text: 'Notifications are on for this device. Send a test to be sure.' })
    await refresh()
  }

  async function turnOff() {
    setBusy(true)
    setNotice(null)
    const result = await disablePush()
    setBusy(false)
    setNotice(result.ok
      ? { kind: 'ok', text: 'Notifications are off for this device.' }
      : { kind: 'error', text: result.error })
    await refresh()
  }

  async function test() {
    setBusy(true)
    setNotice(null)
    const result = await sendTestPush()
    setBusy(false)
    setNotice(result.ok
      ? { kind: 'ok', text: 'Test sent — it should appear within a few seconds, with sound.' }
      : { kind: 'error', text: result.error })
  }

  return (
    <Card className={`${compact ? 'p-3' : 'p-4'} space-y-3`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">Phone notifications</div>
          <div className="text-xs text-slate-600">
            Announcements and new vacancies reach this device even when the app is closed.
          </div>
        </div>
        <Badge color={state === 'on' ? 'green' : state === 'denied' ? 'red' : 'amber'}>
          {state === 'loading' ? 'Checking…'
            : state === 'on' ? 'On'
              : state === 'denied' ? 'Blocked'
                : state === 'needs-install' ? 'Add to Home Screen'
                  : state === 'platform-off' ? 'Not yet available'
                    : state === 'off' ? 'Off' : 'Not enabled'}
        </Badge>
      </div>

      <p className="text-xs text-slate-700">
        {state === 'loading' ? 'Checking this device…' : pushAvailabilityMessage(state)}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {(state === 'ask' || state === 'off') && (
          <Button className="px-3 py-2 text-sm" disabled={busy} onClick={() => { void turnOn() }}>
            {busy ? 'Turning on…' : '🔔 Turn on notifications'}
          </Button>
        )}
        {state === 'on' && (
          <>
            <Button variant="secondary" className="px-3 py-2 text-sm" disabled={busy} onClick={() => { void test() }}>
              {busy ? 'Working…' : 'Send a test'}
            </Button>
            <Button variant="secondary" className="px-3 py-2 text-sm" disabled={busy} onClick={() => { void turnOff() }}>
              Turn off
            </Button>
          </>
        )}
        {state === 'needs-install' && (
          <Button variant="secondary" className="px-3 py-2 text-sm" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            How to install
          </Button>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input
          type="checkbox"
          checked={sound}
          onChange={(event) => { setSound(event.target.checked); setSoundEnabled(event.target.checked) }}
        />
        Play a sound when an announcement arrives while the app is open
      </label>

      {notice && (
        <p
          role="status"
          className={`rounded-lg px-2.5 py-2 text-xs font-semibold ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}
        >
          {notice.text}
        </p>
      )}

      <p className="text-[11px] leading-snug text-slate-500">
        Notifications are sent by the platform, never by other users. Turning them off removes this device from the
        list the next time it reaches the server.
      </p>
    </Card>
  )
}
