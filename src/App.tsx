import { useCallback, useEffect, useState } from 'react'
import { LoginScreen } from './screens/LoginScreen'
import { AdminLoginScreen } from './screens/AdminLoginScreen'
import { AdminMfaScreen } from './screens/AdminMfaScreen'
import { VacancyLoginScreen } from './screens/VacancyLoginScreen'
import { VacancyPortal } from './screens/VacancyPortal'
import { AdminScreen } from './screens/AdminScreen'
import type { UserTab } from './data/tabs'
import { TopBar, Button, Modal } from './components/ui'
import { NotificationsPanel } from './components/NotificationsPanel'
import { HomeScreen } from './screens/HomeScreen'
import { PriorityScreen } from './screens/PriorityScreen'
import { PlansScreen } from './screens/PlansScreen'
import { AccountScreen } from './screens/AccountScreen'
import { AIChatScreen } from './screens/AIChatScreen'
import { Wordmark } from './components/Logo'
import { currentUser, getAuthSnapshot, logout as doLogout, onAuthStateChange, type AuthSnapshot, type User } from './data/auth'
import { clearJobs, loadVisibleJobs, purgeLegacyJobs, type Job } from './data/jobs'
import { unlockActive } from './data/unlockWindow'
import { PullToRefreshIndicator } from './components/PullToRefresh'
import { usePullToRefresh } from './components/usePullToRefresh'
import { ApplyConfirmSheet, JobDetail } from './components/JobDetail'
import { clearMyApplicationCache, openApplication } from './data/apply'
import { getProfile, profileCompletionIssues, type Profile } from './data/profile'
import { clearResumeCache, getLatestResume, type ResumeRecord } from './data/resume'
import { playNotifSound, refreshNotificationsAndAlert, soundEnabled, unreadCount } from './data/notifications'
import { showSystemNotification, syncPushSubscription } from './data/push'
import { clearSupportCache } from './data/supportRequests'
import { clearPaymentCache } from './data/payments'
import { installBackGuard } from './data/backstack'
import { useBackHandler } from './components/useBackHandler'
import { AdBanner } from './components/AdBanner'
import { adaptiveBannerHeightPx, bannerAllowedOnTab, rewardedUnlockOffered, type UnlockStage } from './data/adConfig'
import { isAndroidApp } from './data/platform'
import { adsDiagnostics, initAds, preloadRewardedUnlock, showRewardedUnlock, type RewardedOutcome } from './data/ads'
import { pollForCompanyUnlock } from './data/companyUnlocks'

type View = 'loading' | 'login' | 'admin-login' | 'admin-mfa' | 'vacancy-login' | 'user' | 'admin' | 'vacancy'

/**
 * The job-seeker menu. Passes sit at the very end, without a gem or a badge:
 * a pass is something you buy when you want a manager's contact, not the
 * headline of the product. Job hunting stays the subject of every screen.
 */
const USER_MENU_ITEMS: { id: UserTab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'priority', label: 'Priority Jobs', icon: '⭐' },
  { id: 'ai', label: 'AI Help', icon: '🤖' },
  { id: 'account', label: 'Account & Profile', icon: '👤' },
  { id: 'plans', label: 'Passes & pricing', icon: '🎫' },
]
export default function App() {
  const [adminPortal] = useState(() => new URLSearchParams(window.location.search).get('portal') === 'admin')
  // ?portal=vacancy: the vacancy team's own login and page (post and delete only).
  const [vacancyPortal] = useState(() => new URLSearchParams(window.location.search).get('portal') === 'vacancy')
  const portalLoginView: View = vacancyPortal ? 'vacancy-login' : adminPortal ? 'admin-login' : 'login'
  const [view, setView] = useState<View>('loading')
  const [authTimedOut, setAuthTimedOut] = useState(false)
  const [now, setClock] = useState(Date.now)
  const [user, setUser] = useState<User | null>(null)
  // The tab the user is on plus the tabs they came from, so the phone's back
  // button steps back through the pages they visited here (Home → Plans →
  // back → Home) instead of closing the app.
  const [nav, setNav] = useState<{ tab: UserTab; stack: UserTab[] }>({ tab: 'home', stack: [] })
  const tab = nav.tab
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [applyJob, setApplyJob] = useState<Job | null>(null)
  const [pendingApplyJob, setPendingApplyJob] = useState<Job | null>(null)
  const [profileGateOpen, setProfileGateOpen] = useState(false)
  const [profileMissing, setProfileMissing] = useState<string[]>([])
  const [applyChannel, setApplyChannel] = useState<'email' | 'whatsapp'>('email')
  const [applyTarget, setApplyTarget] = useState<string>('')
  const [resume, setResume] = useState<ResumeRecord | null>(null)
  const [applyBusy, setApplyBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifTick, setNotifTick] = useState(0)
  const [recoveryMode, setRecoveryMode] = useState(false)
  // Job whose company name a rewarded video is unlocking (Android app only).
  const [unlockingJobId, setUnlockingJobId] = useState<string | null>(null)
  const [unlockStage, setUnlockStage] = useState<UnlockStage | null>(null)
  void notifTick

  const applyAuthSnapshot = useCallback((snapshot: AuthSnapshot, resetTab = false) => {
    if (vacancyPortal) {
      // The team portal accepts only a vacancy team session. Anything else is
      // signed out here, as the admin portal does for user sessions.
      setUser(null)
      if (snapshot.session.kind === 'vacancy') {
        setView('vacancy')
        return
      }
      setView('vacancy-login')
      if (snapshot.session.kind !== 'none') window.setTimeout(() => { void doLogout() }, 0)
      return
    }
    if (snapshot.session.kind === 'vacancy') {
      // A team login has no place in the user or admin portals.
      setUser(null)
      setView(portalLoginView)
      window.setTimeout(() => { void doLogout() }, 0)
      return
    }
    if (snapshot.session.kind === 'admin') {
      if (adminPortal) {
        setUser(null)
        setView(snapshot.adminVerified ? 'admin' : 'admin-mfa')
      } else {
        setUser(null)
        setView('login')
        // An admin session must not open the admin console from the user route.
        window.setTimeout(() => { void doLogout() }, 0)
      }
    } else if (snapshot.session.kind === 'user' && snapshot.user) {
      if (adminPortal) {
        setUser(null)
        setView('admin-login')
        // User sessions are not carried into the restricted admin portal.
        window.setTimeout(() => { void doLogout() }, 0)
      } else {
        setUser(snapshot.user)
        setView('user')
        if (resetTab) setNav({ tab: 'home', stack: [] })
      }
    } else {
      setUser(null)
      setView(portalLoginView)
    }
  }, [adminPortal, portalLoginView, vacancyPortal])

  /** Opens a tab, remembering the page it was opened from. */
  const navigate = useCallback((next: UserTab) => {
    setMenuOpen(false)
    setNav((current) => next === current.tab
      ? current
      : { tab: next, stack: [...current.stack, current.tab].slice(-20) })
  }, [])

  /** The back step inside the app: the previous tab, or nothing on Home. */
  const goBackInApp = useCallback(() => {
    setNav((current) => {
      const previous = current.stack[current.stack.length - 1]
      if (!previous) return current
      return { tab: previous, stack: current.stack.slice(0, -1) }
    })
  }, [])

  // Arm the history guard for every page of the app (sign-in included) and let
  // the signed-in page stack answer the back gesture. Sheets and the
  // applications page register above this one, so they close first.
  useEffect(() => { installBackGuard() }, [])

  /**
   * Warm the ad SDK as soon as the app starts, and leave a small diagnostics
   * hook on window. Ads fail silently on purpose, so "no ads" has no visible
   * cause; opening chrome://inspect on the phone and running
   * `await __medrepAds()` now reports whether the request was even attempted
   * and what AdMob answered.
   *
   * Android only — the website never loads the advertising SDK.
   */
  useEffect(() => {
    if (!isAndroidApp()) return
    void initAds()
    ;(window as unknown as { __medrepAds?: typeof adsDiagnostics }).__medrepAds = adsDiagnostics
  }, [])
  useBackHandler(view === 'user', goBackInApp)
  useBackHandler(view === 'user' && menuOpen, () => setMenuOpen(false))

  // Wait for session restoration before showing either login screen. Supabase
  // sends INITIAL_SESSION before the subscription/entitlement query finishes;
  // showing it immediately causes the login screen to flash on refresh.
  useEffect(() => {
    let mounted = true
    let generation = 0
    let newerAuthEvent = false
    const timeout = window.setTimeout(() => { if (mounted) setAuthTimedOut(true) }, 10_000)
    const restore = (resetTab = false) => {
      const request = ++generation
      void getAuthSnapshot()
        .then((snapshot) => { if (mounted && request === generation) applyAuthSnapshot(snapshot, resetTab) })
        .catch(() => { if (mounted && request === generation) setView(portalLoginView) })
    }
    const unsubscribe = onAuthStateChange((event) => {
      if (!mounted) return
      if (event === 'INITIAL_SESSION') {
        if (!newerAuthEvent) { window.clearTimeout(timeout); restore() }
        return
      }
      newerAuthEvent = true
      window.clearTimeout(timeout)
      if (event === 'PASSWORD_RECOVERY') {
        ++generation
        setRecoveryMode(true)
        setUser(null)
        setView(portalLoginView)
      } else if (event === 'SIGNED_OUT') {
        ++generation
        clearPaymentCache(); clearResumeCache(); clearMyApplicationCache(); clearSupportCache()
        clearJobs()
        setRecoveryMode(false)
        setUser(null)
        setSelectedJob(null)
        setApplyJob(null)
        setPendingApplyJob(null)
        setProfileGateOpen(false)
        setProfileMissing([])
        setView(portalLoginView)
      } else {
        if (event === 'SIGNED_IN') { clearPaymentCache(); clearResumeCache(); clearMyApplicationCache(); clearSupportCache(); clearJobs() }
        if (event === 'USER_UPDATED') setRecoveryMode(false)
        restore(event === 'SIGNED_IN')
      }
    })
    // Supabase must finish restoring the persisted session before we decide
    // which page to show. Calling getSession earlier can briefly render login.
    return () => { mounted = false; ++generation; window.clearTimeout(timeout); unsubscribe() }
  }, [portalLoginView, applyAuthSnapshot])

  // Keep time-based access in sync without a page reload. Recheck the server
  // on returning to the app (e.g. after a Razorpay UPI-app handoff/webhook).
  useEffect(() => {
    const tick = () => setClock(Date.now())
    const interval = window.setInterval(tick, 30_000)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      tick()
      const before = currentUser()
      if (!before || before.isAdmin) return
      void getAuthSnapshot().then((snapshot) => {
        if (currentUser()?.id === before.id) applyAuthSnapshot(snapshot)
      }).catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [applyAuthSnapshot])

  const unlocked = Boolean(user?.subscribedUntil && user.subscribedUntil > now)

  const userId = user?.id
  const userEmail = user?.email ?? ''
  useEffect(() => {
    if (view !== 'user' || !userId) {
      if (view === 'login' || view === 'admin-login') clearJobs()
      return
    }
    // A signed-in user only sees the server-projected job catalog. Discard
    // paid details when their account or entitlement changes.
    clearJobs()
    purgeLegacyJobs()
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setJobs([])
      setSelectedJob(null)
      setApplyJob(null)
      setJobsLoading(true)
      setJobsError(null)
    })
    void loadVisibleJobs()
      .then((result) => { if (active) setJobs(result) })
      .catch((cause) => { if (active) setJobsError(cause instanceof Error ? cause.message : 'Jobs are unavailable.') })
      .finally(() => { if (active) setJobsLoading(false) })
    return () => { active = false }
  }, [view, userId, unlocked])

  // Keep the stored resume in sync so the apply sheet can offer a secure
  // download without leaving the current screen.
  useEffect(() => {
    if (view !== 'user' || !userId) { queueMicrotask(() => setResume(null)); return }
    let active = true
    void getLatestResume()
      .then((stored) => { if (active) setResume(stored) })
      .catch(() => { if (active) setResume(null) })
    return () => { active = false }
  }, [view, userId])

  // Keep this account's visible feed (broadcasts plus private notices) in sync,
  // and only ring for notifications the signed-in user is allowed to see.
  useEffect(() => {
    if (view !== 'user' || !userId || !userEmail) return
    let active = true
    const check = async () => {
      const fresh = await refreshNotificationsAndAlert(userEmail)
      if (!active || fresh.length === 0) return
      if (soundEnabled()) playNotifSound()
      const first = fresh[0]
      await showSystemNotification(
        fresh.length === 1 ? first.title : `${fresh.length} new updates`,
        first.body,
        first.id,
      )
    }
    void check()
    const interval = window.setInterval(() => { void check() }, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [view, userId, userEmail])

  // A signed-in account keeps this device's notification subscription in its own
  // name, so a phone that switched accounts stops reaching the previous one.
  useEffect(() => {
    if (view !== 'user' || !userId) return
    void syncPushSubscription()
  }, [view, userId])

  function refreshUser() {
    const u = currentUser()
    if (u) setUser({ ...u })
  }

  /**
   * Swipe-down refresh: re-read the server projection and the account.
   *
   * The job list is the only place the per-job `companyUnlocked` flag lives, and
   * until now nothing could re-read it without leaving the screen — so a company
   * unlocked by a video could still look locked after a restart.
   */
  const refreshFromServer = useCallback(async () => {
    if (!userId) return
    setJobsError(null)
    try {
      const fresh = await loadVisibleJobs()
      setJobs(fresh)
      setSelectedJob((current) => (current ? fresh.find((job) => job.id === current.id) ?? current : current))
      refreshUser()
    } catch (cause) {
      setJobsError(cause instanceof Error ? cause.message : 'Jobs are unavailable.')
    }
  }, [userId])

  const { pull, refreshing } = usePullToRefresh(refreshFromServer, Boolean(userId) && !menuOpen)

  /**
   * Publish the strip of screen the native banner owns as `--ad-reserve`.
   *
   * Any overlay anchored to the bottom of the screen (the menu's footer, a
   * sheet) pads itself by that amount, so its buttons sit ABOVE the banner
   * instead of underneath it. This is a layout reserve, not a native call:
   * hiding and re-showing the banner on every menu tap made the SDK answer
   * with 15-second timeouts (see the trace in the ad card), and the banner
   * then took seconds to come back.
   */
  useEffect(() => {
    const apply = () => {
      // +8 px of breathing room, so a page's last line never touches the ad.
      const reserve = isAndroidApp() && bannerAllowedOnTab(nav.tab)
        ? adaptiveBannerHeightPx(window.innerWidth) + 8
        : 0
      document.documentElement.style.setProperty('--ad-reserve', `${reserve}px`)
    }
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      document.documentElement.style.setProperty('--ad-reserve', '0px')
    }
  }, [nav.tab])

  function onAuthed() {
    setRecoveryMode(false)
    // SIGNED_IN/USER_UPDATED restores the authenticated view after the
    // server-owned subscription has been loaded.
  }

  async function onLogout() {
    clearPaymentCache(); clearResumeCache(); clearMyApplicationCache(); clearSupportCache()
    clearJobs()
    await doLogout()
    setRecoveryMode(false)
    setUser(null)
    setSelectedJob(null)
    setApplyJob(null)
    setPendingApplyJob(null)
    setProfileGateOpen(false)
    setProfileMissing([])
    setView(portalLoginView)
  }

  function openJob(j: Job) {
    setSelectedJob(j)
    // Start fetching the unlock video now, so tapping the button plays instead of
    // waiting. Free Android users only — subscribers have no video to watch.
    if (user && isAndroidApp() && !unlocked) preloadRewardedUnlock(user.id, j.id)
  }

  /**
   * Rewarded video → company name for ONE job (Android app, free users).
   * The video completion alone unlocks nothing: AdMob's server-side
   * verification writes the unlock, and we poll the server projection until
   * it arrives. Subscribers never reach this (no rewarded videos for them).
   */
  const watchToUnlockCompany = useCallback(async (job: Job) => {
    if (!user || unlockingJobId) return
    if (!rewardedUnlockOffered({ isAndroidApp: isAndroidApp(), subscribed: unlocked, companyUnlocked: unlockActive(job) })) return
    setUnlockingJobId(job.id)
    setUnlockStage('loading')
    try {
      // The Play/AdMob video UI can be dismissed without ever calling back.
      // showRewardedUnlock reports its own progress (loading → watching →
      // verifying) and gives up on a stalled LOAD after 20 seconds, so the
      // button never sits on "Checking your unlock…" while nothing is happening.
      // This race is only the last-resort backstop for a show() that never
      // resolves; it is long enough for a full video plus confirmation.
      const outcome = await Promise.race<RewardedOutcome>([
        showRewardedUnlock(user.id, job.id, setUnlockStage),
        new Promise<RewardedOutcome>((resolve) => {
          window.setTimeout(() => resolve({
            ok: false,
            error: 'The video did not start or finish in time. Please try again.',
          }), 180_000)
        }),
      ])
      if (!outcome.ok) {
        showToast(outcome.error)
        return
      }
      const updated = await pollForCompanyUnlock(job.id, {
        onJobs: (fresh) => {
          setJobs(fresh)
          setSelectedJob((current) => current?.id === job.id
            ? fresh.find((candidate) => candidate.id === job.id) ?? current
            : current)
        },
      })
      showToast(updated?.company
        ? `Company unlocked: ${updated.company} ✓`
        : 'Video complete — your unlock is being confirmed and will appear shortly.')
    } finally {
      setUnlockingJobId(null)
      setUnlockStage(null)
    }
    // showToast is intentionally not a dependency; it only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, unlocked, unlockingJobId])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  function openApplyConfirmation(job: Job) {
    const email = (job.managerEmail || '').trim()
    const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    const phone = (job.contact || '').replace(/[^\d]/g, '')
    const hasPhone = phone.replace(/^0/, '').replace(/^91/, '').length === 10 || phone.length >= 10
    setApplyChannel(hasEmail ? 'email' : hasPhone ? 'whatsapp' : 'email')
    setApplyTarget(hasEmail ? email : (job.contact || ''))
    setSelectedJob(null)
    setApplyJob(job)
  }

  function requestApplication(job: Job) {
    if (!user) return
    const missing = profileCompletionIssues(getProfile(user.email), user.phone)
    if (missing.length > 0) {
      setPendingApplyJob(job)
      setProfileMissing(missing)
      setProfileGateOpen(true)
      setSelectedJob(null)
      return
    }
    openApplyConfirmation(job)
  }

  function handleProfileSaved(profile: Profile) {
    refreshUser()
    if (!pendingApplyJob) return
    const missing = profileCompletionIssues(profile)
    setProfileMissing(missing)
    if (missing.length > 0) {
      showToast('Profile saved. Complete the remaining required details to apply.')
      return
    }
    const job = pendingApplyJob
    setPendingApplyJob(null)
    setProfileGateOpen(false)
    goBackInApp()
    openApplyConfirmation(job)
    showToast('Profile complete — continuing your application.')
  }

  if (view === 'loading') {
    // A dead connection must not look like a frozen app: after ten seconds the
    // spinner becomes a card with a way out, instead of "Loading your account…"
    // spinning forever.
    return (
      <main role="status" aria-live="polite" className="hero-mesh grid min-h-[100dvh] place-items-center px-6 text-center text-white">
        {authTimedOut ? (
          <div className="w-full max-w-sm space-y-3">
            <div className="text-4xl" aria-hidden="true">📶</div>
            <div className="text-xl font-extrabold">Can't reach MedRep Pro</div>
            <p className="text-base font-medium text-white/85">
              Your connection looks down, or the server is busy. Nothing on your account has changed.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-2xl bg-white px-4 py-3 text-base font-bold text-brand-800 shadow-lg transition hover:bg-brand-50 active:scale-95"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => setView(portalLoginView)}
              className="w-full rounded-2xl bg-white/10 px-4 py-3 text-base font-bold text-white ring-1 ring-white/30 transition hover:bg-white/15 active:scale-95"
            >
              Go to sign in
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-lg font-bold">Loading your account…</div>
            <div className="text-sm font-medium text-white/75">Checking your saved session.</div>
          </div>
        )}
      </main>
    )
  }

  if (view === 'login') {
    return <LoginScreen onAuthed={onAuthed} recoveryMode={recoveryMode} />
  }

  if (view === 'admin-login') {
    return <AdminLoginScreen onAuthed={onAuthed} recoveryMode={recoveryMode} />
  }

  if (view === 'admin-mfa') {
    return <AdminMfaScreen onVerified={() => {
      void getAuthSnapshot().then((snapshot) => applyAuthSnapshot(snapshot)).catch(() => setView('admin-mfa'))
    }} onExit={onLogout} />
  }

  if (view === 'admin') {
    return <AdminScreen onExit={onLogout} />
  }

  if (view === 'vacancy-login') {
    return <VacancyLoginScreen onAuthed={onAuthed} />
  }

  if (view === 'vacancy') {
    return <VacancyPortal onExit={onLogout} />
  }

  // User app
  return (
    <div
      className="min-h-[100dvh]"
      // The banner is a native view over the bottom of the WebView, so the app
      // itself gives that strip away: every screen — and every footer inside
      // it — ends above the ad instead of scrolling under it.
      style={{ paddingBottom: 'var(--ad-reserve, 0px)' }}
    >
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <TopBar
        left={
          <span className="inline-flex min-w-0 items-center gap-2">
            {nav.stack.length > 0 && (
              <button
                type="button"
                onClick={goBackInApp}
                aria-label="Back"
                title="Back"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-white text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}
            <Wordmark size="text-sm" />
          </span>
        }
        title={
          <span className="capitalize">
            {tab === 'home' && 'Home'}
            {tab === 'priority' && 'Priority Jobs'}
            {tab === 'plans' && 'Passes'}
            {tab === 'ai' && 'AI Help'}
            {tab === 'account' && 'Account'}
          </span>
        }
        right={
          <button
            type="button"
            title="Open navigation menu"
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        }
      />

      {(jobsLoading || jobsError) && (tab === 'home' || tab === 'priority') && (
        <div role={jobsError ? 'alert' : 'status'} className={`max-w-3xl mx-auto px-4 pt-4 text-base font-semibold ${jobsError ? 'text-red-800' : 'text-slate-700'}`}>
          {jobsError || 'Loading secure vacancies…'}
        </div>
      )}
      {tab === 'home' && user && (
        <HomeScreen
          user={user}
          jobs={jobs}
          onOpenJob={openJob}
          onWatchUnlock={isAndroidApp() && !unlocked ? watchToUnlockCompany : undefined}
          unlockingJobId={unlockingJobId}
          unlockStage={unlockStage}
        />
      )}
      {tab === 'priority' && user && (
        <PriorityScreen user={user} jobs={jobs} onOpenJob={openJob} onWatchUnlock={isAndroidApp() && !unlocked ? watchToUnlockCompany : undefined} unlockingJobId={unlockingJobId} unlockStage={unlockStage} />
      )}
      {tab === 'plans' && user && (
        <PlansScreen user={user} onSubscribed={(u) => { setUser(u); showToast('Subscription active!') }} />
      )}
      {tab === 'ai' && user && <AIChatScreen user={user} />}
      {tab === 'account' && user && (
        <AccountScreen
          user={user}
          onLogout={onLogout}
          onSubscribed={() => refreshUser()}
          onProfileSaved={handleProfileSaved}
          onResumeChange={setResume}
          onBrowseJobs={() => navigate('home')}
          onViewPasses={() => navigate('plans')}
        />
      )}

      {/* AdMob adaptive banner: content screens only, Android app only.
          Plans is the payment screen and login/sign-up never reach this
          shell, so no ads ever appear there. The banner owns the very bottom
          edge of the screen on every tab; anything else that wants to be near
          that edge (Account's Save/Logout bar, a bottom sheet, the menu list)
          offsets itself by --ad-reserve instead. */}
      <AdBanner enabled={bannerAllowedOnTab(tab)} />

      {menuOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/35"
          onClick={() => setMenuOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMenuOpen(false)
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-menu-title"
            className="absolute inset-y-0 right-0 flex w-72 max-w-[84vw] flex-col rounded-l-[28px] border-l border-white/70 bg-white/95 shadow-[-24px_0_60px_-30px_rgba(15,23,42,0.6)] backdrop-blur-xl animate-slide-in-right"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <h2 id="user-menu-title" className="text-lg font-bold text-slate-900">Menu</h2>
                <p className="mt-1 truncate text-sm font-semibold text-slate-800">{user?.name || 'Your account'}</p>
                {user?.email && <p className="truncate text-xs text-slate-500">{user.email}</p>}
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setMenuOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                ×
              </button>
            </div>

            {/* The list keeps a bottom reserve the size of the native banner,
                so its last row can always be scrolled clear of it. */}
            <nav
              aria-label="App sections"
              className="flex-1 space-y-2 overflow-y-auto p-4"
              style={{ paddingBottom: 'calc(1rem + var(--ad-reserve, 0px))' }}
            >
              {USER_MENU_ITEMS.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant={tab === item.id ? 'primary' : 'secondary'}
                  className="w-full justify-start"
                  aria-current={tab === item.id ? 'page' : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                  {tab === item.id && <span className="ml-auto text-xs opacity-80">Current</span>}
                </Button>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-start"
                onClick={() => {
                  setMenuOpen(false)
                  setNotifOpen(true)
                }}
              >
                <span aria-hidden="true">🔔</span>
                <span>Notifications</span>
                {user && unreadCount(user.email) > 0 && (
                  <span className="ml-auto min-w-6 rounded-full bg-red-600 px-2 py-0.5 text-center text-xs font-bold text-white">
                    {unreadCount(user.email) > 99 ? '99+' : unreadCount(user.email)}
                  </span>
                )}
              </Button>
              {/* Log out lives in the list, not in a footer pinned to the bottom
                  edge: the native ads banner always owns that edge, and a footer
                  there could only be reached if the banner moved away. As a list
                  item it scrolls into view with a clear gap above it. */}
              <div className="pt-3 mt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="danger"
                  className="w-full justify-start"
                  onClick={() => {
                    setMenuOpen(false)
                    void onLogout()
                  }}
                >
                  <span aria-hidden="true">🚪</span>
                  <span>Log out</span>
                </Button>
              </div>
            </nav>
          </aside>
        </div>
      )}

      <JobDetail
        job={selectedJob}
        unlocked={unlocked}
        onClose={() => setSelectedJob(null)}
        onSubscribe={() => { setSelectedJob(null); navigate('plans') }}
        onApply={requestApplication}
        onWatchUnlock={isAndroidApp() && !unlocked ? watchToUnlockCompany : undefined}
        unlockStage={selectedJob && unlockingJobId === selectedJob.id ? unlockStage : null}
      />
      <Modal
        open={profileGateOpen}
        onClose={() => {
          setProfileGateOpen(false)
          setPendingApplyJob(null)
        }}
        title="Complete your profile first"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            Finish these details before applying for <span className="font-bold">{pendingApplyJob?.title || 'this job'}</span>:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm font-medium text-slate-800">
            {profileMissing.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
          <p className="text-xs text-slate-600">
            Work experience is optional for freshers. DOB, gender, expected CTC, notice period, and resume are optional too.
          </p>
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setProfileGateOpen(false)
                setPendingApplyJob(null)
              }}
            >
              Not now
            </Button>
            <Button onClick={() => {
              setProfileGateOpen(false)
              navigate('account')
            }}>
              Complete profile
            </Button>
          </div>
        </div>
      </Modal>
      <ApplyConfirmSheet
        job={applyJob}
        channel={applyChannel}
        target={applyTarget}
        resume={resume}
        busy={applyBusy}
        onClose={() => { if (!applyBusy) setApplyJob(null) }}
        onConfirm={() => {
          if (!applyJob || !user || applyBusy) return
          setApplyBusy(true)
          void openApplication(user, applyJob, resume)
            .then((result) => {
              if (result.ok) {
                const opened = result.channel === 'email'
                  ? `Mail app opened — send to ${applyJob.manager || 'manager'} ✉️`
                  : `WhatsApp opened — message ${applyJob.manager || 'manager'} 💬`
                showToast(result.historyError ? `${opened} ${result.historyError}` : opened)
                setApplyJob(null)
              } else {
                showToast(result.error)
              }
            })
            .finally(() => setApplyBusy(false))
        }}
      />

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {user && (
        <NotificationsPanel open={notifOpen} onClose={() => { setNotifOpen(false); setNotifTick((t) => t + 1) }} email={user.email} />
      )}
    </div>
  )
}
