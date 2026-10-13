import { useCallback, useEffect, useState } from 'react'
import { LoginScreen } from './screens/LoginScreen'
import { AdminLoginScreen } from './screens/AdminLoginScreen'
import { AdminMfaScreen } from './screens/AdminMfaScreen'
import { VacancyLoginScreen } from './screens/VacancyLoginScreen'
import { VacancyPortal } from './screens/VacancyPortal'
import { AdminScreen } from './screens/AdminScreen'
import { BottomNav, type UserTab } from './components/BottomNav'
import { TopBar, IconButton } from './components/ui'
import { NotificationsPanel } from './components/NotificationsPanel'
import { HomeScreen } from './screens/HomeScreen'
import { PriorityScreen } from './screens/PriorityScreen'
import { PlansScreen } from './screens/PlansScreen'
import { AccountScreen } from './screens/AccountScreen'
import { AIChatScreen } from './screens/AIChatScreen'
import { Wordmark } from './components/Logo'
import { currentUser, getAuthSnapshot, logout as doLogout, onAuthStateChange, type AuthSnapshot, type User } from './data/auth'
import { clearJobs, loadVisibleJobs, purgeLegacyJobs, type Job } from './data/jobs'
import { ApplyConfirmSheet, JobDetail } from './components/JobDetail'
import { clearMyApplicationCache, openApplication } from './data/apply'
import { clearResumeCache, getLatestResume, type ResumeRecord } from './data/resume'
import { refreshNotificationsFromServer, unreadCount } from './data/notifications'
import { clearSupportCache } from './data/supportRequests'
import { clearPaymentCache } from './data/payments'
import { installBackGuard } from './data/backstack'
import { useBackHandler } from './components/useBackHandler'

type View = 'loading' | 'login' | 'admin-login' | 'admin-mfa' | 'vacancy-login' | 'user' | 'admin' | 'vacancy'

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
  const [applyChannel, setApplyChannel] = useState<'email' | 'whatsapp'>('email')
  const [applyTarget, setApplyTarget] = useState<string>('')
  const [resume, setResume] = useState<ResumeRecord | null>(null)
  const [applyBusy, setApplyBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifTick, setNotifTick] = useState(0)
  const [recoveryMode, setRecoveryMode] = useState(false)
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
  useBackHandler(view === 'user', goBackInApp)

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

  // Keep the broadcast feed (new job posts + every job update) in sync so the
  // notification bell reflects admin activity without a manual refresh.
  useEffect(() => {
    if (view !== 'user' || !userId) return
    void refreshNotificationsFromServer()
    const interval = window.setInterval(() => { void refreshNotificationsFromServer() }, 60_000)
    return () => window.clearInterval(interval)
  }, [view, userId])

  function refreshUser() {
    const u = currentUser()
    if (u) setUser({ ...u })
  }

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
    setView(portalLoginView)
  }

  function openJob(j: Job) {
    setSelectedJob(j)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  if (view === 'loading') {
    return <main role="status" aria-live="polite" className="min-h-screen bg-brand-50 grid place-items-center px-6 text-center text-brand-900 font-bold text-lg">
      <div>Loading your account…
        {authTimedOut && <div className="mt-3 text-base">Sign-in is taking longer than expected. Check your connection, then <button className="underline" onClick={() => window.location.reload()}>retry</button>.</div>}
      </div>
    </main>
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
    <div className="min-h-screen bg-slate-50">
      <TopBar
        left={
          <span className="inline-flex">
            <Wordmark size="text-sm" />
          </span>
        }
        title={
          <span className="capitalize">
            {tab === 'home' && 'Home'}
            {tab === 'priority' && 'Priority Jobs'}
            {tab === 'plans' && 'Plans'}
            {tab === 'ai' && 'AI Help'}
            {tab === 'account' && 'Account'}
          </span>
        }
        right={
          <div className="flex items-center gap-2">
            {user && (
              <IconButton
                title="Notifications"
                badge={user ? unreadCount(user.email) : 0}
                onClick={() => setNotifOpen(true)}
              >
                🔔
              </IconButton>
            )}
            {!unlocked && (
              <button
                type="button"
                title="Subscribe"
                aria-label="Subscribe"
                onClick={() => navigate('plans')}
                className="w-8 h-8 shrink-0 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-base leading-none grid place-items-center shadow-sm transition active:scale-95 select-none"
              >
                💎
              </button>
            )}
          </div>
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
        />
      )}
      {tab === 'priority' && user && (
        <PriorityScreen user={user} jobs={jobs} onOpenJob={openJob} />
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
          onResumeChange={setResume}
          onBrowseJobs={() => navigate('home')}
        />
      )}

      <BottomNav active={tab} onChange={navigate} />

      <JobDetail
        job={selectedJob}
        unlocked={unlocked}
        onClose={() => setSelectedJob(null)}
        onSubscribe={() => { setSelectedJob(null); navigate('plans') }}
        onApply={(j) => {
          const email = (j.managerEmail || '').trim()
          const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          const phone = (j.contact || '').replace(/[^\d]/g, '')
          const hasPhone = phone.replace(/^0/, '').replace(/^91/, '').length === 10 || phone.length >= 10
          setApplyChannel(hasEmail ? 'email' : hasPhone ? 'whatsapp' : 'email')
          setApplyTarget(hasEmail ? email : (j.contact || ''))
          setSelectedJob(null)
          setApplyJob(j)
        }}
      />
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
