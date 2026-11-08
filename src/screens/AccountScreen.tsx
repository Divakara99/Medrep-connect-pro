import { useRef, useState } from 'react'
import { Button, Card, Badge } from '../components/ui'
import { Logo } from '../components/Logo'
import { ProfileEditor, type ProfileEditorHandle } from '../components/ProfileEditor'
import { MyRequests } from '../components/MyRequests'
import { ApplicationsScreen } from './ApplicationsScreen'
import { isSubscribed, type User } from '../data/auth'
import { isAndroidApp } from '../data/platform'
import { CREATOR } from '../data/creator'
import type { ResumeRecord } from '../data/resume'
import type { Profile } from '../data/profile'
import { APP_BUILD_LABEL, APP_VERSION_LABEL } from '../data/version'
import { adsDiagnostics, adsDiagnosticsText, pingAdSdk, probeAdNetwork, probeBanner, type NetworkProbe } from '../data/ads'
import { loadMyUnlocks } from '../data/companyUnlocks'

export function AccountScreen({
  user,
  onLogout,
  onSubscribed,
  onProfileSaved,
  onResumeChange,
  onBrowseJobs,
  onViewPasses,
}: {
  user: User
  onLogout: () => void
  onSubscribed: (u: User) => void
  onProfileSaved: (profile: Profile) => void
  onResumeChange: (resume: ResumeRecord | null) => void
  onBrowseJobs: () => void
  /** Passes live one tap away, quietly — the account page is not a shop window. */
  onViewPasses: () => void
}) {
  const unlocked = isSubscribed(user)
  const editorRef = useRef<ProfileEditorHandle>(null)
  // "My applications" opens as its own page over this one, so the phone's back
  // button (and its Back button) return here.
  const [applicationsOpen, setApplicationsOpen] = useState(false)
  /**
   * Hidden ad diagnostics (Android only), opened by tapping the version badge
   * five times.
   *
   * Ads fail silently by design, so "no ads" arrives with no cause attached and
   * no way to read it on a phone without a USB cable and chrome://inspect. This
   * surfaces AdMob's own answer — no fill, missing app id, not initialised —
   * right on the device. A manual request button makes it testable on the spot.
   */
  const versionTaps = useRef({ count: 0, timer: 0 })
  const [adsDebugOpen, setAdsDebugOpen] = useState(false)
  const [adsState, setAdsState] = useState<ReturnType<typeof adsDiagnostics> | null>(null)
  const [adsBusy, setAdsBusy] = useState(false)
  const [copyNote, setCopyNote] = useState('')
  const [netBusy, setNetBusy] = useState(false)
  const [netResults, setNetResults] = useState<NetworkProbe[] | null>(null)
  const [pingNote, setPingNote] = useState('')
  const [pingBusy, setPingBusy] = useState(false)
  const [unlockNote, setUnlockNote] = useState('')
  const [unlockBusy, setUnlockBusy] = useState(false)

  /** The card as plain text, so it can be pasted instead of photographed. */
  const diagnosticsText = adsState ? adsDiagnosticsText() : ''

  function onVersionTap() {
    if (!isAndroidApp()) return
    const taps = versionTaps.current
    taps.count += 1
    window.clearTimeout(taps.timer)
    if (taps.count >= 5) {
      taps.count = 0
      setAdsDebugOpen(true)
      setAdsState(adsDiagnostics())
      return
    }
    taps.timer = window.setTimeout(() => { taps.count = 0 }, 1500)
  }

  if (applicationsOpen) {
    return (
      <ApplicationsScreen
        onClose={() => setApplicationsOpen(false)}
        onBrowseJobs={() => { setApplicationsOpen(false); onBrowseJobs() }}
      />
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pt-4 pb-24 space-y-4">
      <Card className="hairline flex items-center gap-3.5 bg-gradient-to-br from-white to-brand-50/60 p-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-700 text-2xl font-extrabold text-white shadow-[0_16px_30px_-18px_rgba(29,78,216,0.95)] ring-1 ring-white/50">
          {user.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-extrabold tracking-tight text-slate-900">{user.name}</div>
          <div className="text-xs text-slate-500 truncate">{user.email}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge color="brand">Job Seeker</Badge>
            {unlocked ? (
              <Badge color="green">✓ Subscribed</Badge>
            ) : (
              <Badge color="amber">Free plan</Badge>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-bold text-slate-900">Contact access</h2>
        {unlocked && user.subscribedUntil ? (
          <>
            {/* The validity date itself is shown in green so it is unmissable. */}
            <p className="text-sm font-bold text-emerald-700 mt-1">
              Active until {new Date(user.subscribedUntil).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            <p className="text-xs text-slate-700 mt-1">
              Renewals extend the current expiry; new plans start after server-verified payment.
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-600 mt-1">
            Browsing vacancies is free for everyone. A pass is only needed for the manager&apos;s name, email and phone number.
          </p>
        )}
      </Card>

      <ProfileEditor
        ref={editorRef}
        email={user.email}
        phone={user.phone}
        onSaved={(profile) => {
          onSubscribed({ ...user, phone: profile.phone })
          onProfileSaved(profile)
        }}
        onResumeChange={onResumeChange}
      />

      <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">My applications</div>
          <div className="text-xs text-slate-600">Every email / WhatsApp application you have sent, with the job it was sent for.</div>
        </div>
        <Button variant="secondary" className="shrink-0" onClick={() => setApplicationsOpen(true)}>
          📄 My applications
        </Button>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">Passes &amp; pricing</div>
          <div className="text-xs text-slate-600">
            {isAndroidApp() ? 'Google Play prices, shown when you choose a pass.' : 'Razorpay / UPI prices, shown when you choose a pass.'}
          </div>
        </div>
        <Button variant="secondary" className="shrink-0" onClick={onViewPasses}>
          🎫 View passes
        </Button>
      </Card>

      <MyRequests />

      {/* About card: same brand mark that ships as the PWA icon, plus the
          released version (package.json → build-time constant, never typed twice). */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Logo size={40} />
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900">MedRep Connect Pro</div>
              <div className="text-xs text-slate-500 truncate">{CREATOR.tagline}</div>
              <div className="text-[11px] text-slate-500 truncate">Operated by {CREATOR.owner} · {CREATOR.location}</div>
              <a href={`mailto:${CREATOR.contactEmail}`} className="text-[11px] font-semibold text-blue-600 underline underline-offset-2 truncate block">
                {CREATOR.contactEmail}
              </a>
            </div>
          </div>
          <button type="button" onClick={onVersionTap} aria-label="App version" className="shrink-0 text-right">
            <Badge color="brand">{APP_VERSION_LABEL}</Badge>
            <div className="mt-1 text-[10px] font-mono text-slate-400">{APP_BUILD_LABEL}</div>
          </button>
        </div>
      </Card>

      {isAndroidApp() && adsDebugOpen && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="font-bold text-slate-900">
              Ad diagnostics
              <div className="text-[10px] font-mono font-normal text-slate-400">{APP_BUILD_LABEL}</div>
            </div>
            <button
              type="button"
              onClick={() => setAdsDebugOpen(false)}
              className="text-xs font-semibold text-slate-500 underline"
            >
              Hide
            </button>
          </div>
          <div className="text-[11px] font-mono leading-relaxed text-slate-700 break-words">
            <div className="text-slate-500">{adsState?.appId}</div>
            <div className="text-slate-500">banner {adsState?.bannerUnit}</div>
            <div className="text-slate-500">rewarded {adsState?.rewardedUnit}</div>
            <div>plugin loaded: {String(adsState?.pluginLoaded)}</div>
            <div>banner wanted: {String(adsState?.bannerWanted)}</div>
            <div>banner visible: {String(adsState?.bannerVisible)}</div>
            <div>banner attempts: {String(adsState?.bannerAttempts)}{adsState?.bannerPending ? ' (one in flight)' : ''}</div>
            <div>init stage: {adsState?.initStage}</div>
            <div>plugin available: {String(adsState?.pluginAvailable)}</div>
            <div>init error: {adsState?.lastInitError || '—'}</div>
            <div>last banner error: {adsState?.lastBannerError || '—'}</div>
            <div>last video error: {adsState?.lastRewardedError || '—'}</div>
          </div>
          <Button
            variant="secondary"
            disabled={adsBusy}
            onClick={async () => {
              setAdsBusy(true)
              // One bounded attempt — no retry loop, so the card always shows a
              // result instead of sitting on "Requesting…".
              try {
                setAdsState(await probeBanner())
              } finally {
                setAdsBusy(false)
              }
            }}
          >
            {adsBusy ? 'Requesting…' : 'Request a banner ad now'}
          </Button>
          <Button
            variant="secondary"
            disabled={unlockBusy}
            onClick={async () => {
              setUnlockBusy(true)
              setUnlockNote('Reading your unlocks…')
              try {
                const rows = await loadMyUnlocks()
                setUnlockNote(rows.length === 0
                  ? 'No unlock rows for this account — the reward was never recorded.'
                  : `${rows.length} unlock row(s): ${rows.map((row) => row.jobId.slice(0, 8)).join(', ')}`)
              } catch (cause) {
                setUnlockNote(cause instanceof Error ? cause.message : 'Could not read your unlocks.')
              } finally {
                setUnlockBusy(false)
              }
            }}
          >
            {unlockBusy ? 'Checking…' : 'Check my unlocks'}
          </Button>
          {unlockNote && <div className="text-[11px] font-mono text-slate-700 break-words">{unlockNote}</div>}
          <Button
            variant="secondary"
            disabled={pingBusy}
            onClick={async () => {
              setPingBusy(true)
              setPingNote('Asking the SDK…')
              try {
                setPingNote(await pingAdSdk())
              } finally {
                setPingBusy(false)
                setAdsState(adsDiagnostics())
              }
            }}
          >
            {pingBusy ? 'Asking…' : 'Ping ad SDK'}
          </Button>
          {pingNote && <div className="text-[11px] font-mono text-slate-700 break-words">{pingNote}</div>}
          {adsState?.trace && adsState.trace.length > 0 && (
            <div className="text-[10px] font-mono leading-relaxed text-slate-600 break-words space-y-0.5">
              {adsState.trace.slice(-9).map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          )}
          <Button
            variant="secondary"
            disabled={netBusy}
            onClick={async () => {
              setNetBusy(true)
              try {
                setNetResults(await probeAdNetwork())
              } finally {
                setNetBusy(false)
              }
            }}
          >
            {netBusy ? 'Testing…' : 'Test ad network'}
          </Button>
          {netResults && (
            <div className="text-[11px] font-mono leading-relaxed break-words">
              {netResults.map((result) => (
                <div key={result.url} className={result.reachable ? 'text-emerald-700' : 'text-red-700'}>
                  {result.reachable ? 'reachable' : 'BLOCKED'} · {result.ms} ms · {result.detail}
                  <div className="text-slate-500">{result.url}</div>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="text-xs font-semibold text-brand-600 underline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(diagnosticsText)
                setCopyNote('Copied — paste it into the chat')
              } catch {
                setCopyNote('Copy blocked — read the lines above instead')
              }
            }}
          >
            Copy diagnostics
          </button>
          {copyNote && <div className="text-[11px] text-slate-500">{copyNote}</div>}
          <div className="text-[11px] text-slate-500">
            Tap the version badge 5× to reopen. “No fill” means AdMob had nothing to serve;
            any other message is a build or network problem.
          </div>
        </Card>
      )}

      {/* Unified frozen (sticky) action bar: Save primary, Logout secondary.
          Both buttons are anchored together so users don't accidentally hit Logout
          when trying to save, and they can't miss either action. */}
      <div
        className="fixed inset-x-0 z-20 bg-white/95 backdrop-blur border-t border-slate-200 px-4 pt-2.5"
        // The native banner always sits at the very bottom of the screen, so
        // the bar is lifted by --ad-reserve instead of the banner being pushed
        // up: Save and Logout are never underneath an ad.
        style={{
          bottom: 'var(--ad-reserve, 0px)',
          paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))',
        }}
      >
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => editorRef.current?.save()}
          >
            💾 Save profile
          </Button>
          <Button variant="danger" onClick={onLogout}>
            🚪 Logout
          </Button>
        </div>
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </div>
  )
}
