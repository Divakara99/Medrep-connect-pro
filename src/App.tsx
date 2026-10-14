import { useCallback, useEffect, useState } from 'react'
import { LoginScreen } from './screens/LoginScreen'
import { AdminLoginScreen } from './screens/AdminLoginScreen'
import { AdminMfaScreen } from './screens/AdminMfaScreen'
import { VacancyLoginScreen } from './screens/VacancyLoginScreen'
import { VacancyPortal } from './screens/VacancyPortal'
import { AdminScreen } from './screens/AdminScreen'
import type { UserTab } from './components/BottomNav'
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

type View = 'loading' | 'login' | 'admin-login' | 'admin-mfa' | 'vacancy-login' | 'user' | 'admin' | 'vacancy'

const USER_MENU_ITEMS: { id: UserTab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'priority', label: 'Priority Jobs', icon: '⭐' },
  { id: 'plans', label: 'Plans', icon: '💎' },
  { id: 'ai', label: 'AI Help', icon: '🤖' },
  { id: 'account', label: 'Account & Profile', icon: '👤' },
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
  }

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
          <span className="inline-flex min-w-0">
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
          <button
            type="button"
            title="Open navigation menu"
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="w-10 h-10 shrink-0 rounded-xl bg-white ring-1 ring-slate-200 hover:bg-slate-50 text-slate-700 grid place-items-center transition active:scale-95"
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
          onProfileSaved={handleProfileSaved}
          onResumeChange={setResume}
          onBrowseJobs={() => navigate('home')}
        />
      )}

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
            className="absolute inset-y-0 right-0 flex w-72 max-w-[84vw] flex-col bg-white shadow-2xl animate-slide-in-right"
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

            <nav aria-label="App sections" className="flex-1 space-y-2 overflow-y-auto p-4">
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
            </nav>

            <div className="border-t border-slate-200 p-4">
              <Button
                type="button"
                variant="danger"
                className="w-full"
                onClick={() => {
                  setMenuOpen(false)
                  void onLogout()
                }}
              >
                🚪 Log out
              </Button>
            </div>
          </aside>
        </div>
      )}

      <JobDetail
        job={selectedJob}
        unlocked={unlocked}
        onClose={() => setSelectedJob(null)}
        onSubscribe={() => { setSelectedJob(null); navigate('plans') }}
        onApply={requestApplication}
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
