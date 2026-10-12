import { useCallback, useEffect, useState } from 'react'
import { LoginScreen } from './screens/LoginScreen'
import { AdminLoginScreen } from './screens/AdminLoginScreen'
import { AdminScreen } from './screens/AdminScreen'
import { BottomNav, type UserTab } from './components/BottomNav'
import { TopBar, Button, IconButton } from './components/ui'
import { NotificationsPanel } from './components/NotificationsPanel'
import { HomeScreen } from './screens/HomeScreen'
import { PriorityScreen } from './screens/PriorityScreen'
import { PlansScreen } from './screens/PlansScreen'
import { AccountScreen } from './screens/AccountScreen'
import { AIChatScreen } from './screens/AIChatScreen'
import { Wordmark } from './components/Logo'
import { currentUser, getAuthSnapshot, isSubscribed, logout as doLogout, onAuthStateChange, type AuthSnapshot, type User } from './data/auth'
import { getJobs, type Job } from './data/jobs'
import { ApplyConfirmSheet, JobDetail } from './components/JobDetail'
import { openApplication } from './data/apply'
import { unreadCount } from './data/notifications'
import { clearPaymentCache } from './data/payments'

type View = 'loading' | 'login' | 'admin-login' | 'user' | 'admin'

export default function App() {
  const [adminPortal] = useState(() => new URLSearchParams(window.location.search).get('portal') === 'admin')
  const [view, setView] = useState<View>('loading')
  const [, setClock] = useState(Date.now)
  const [user, setUser] = useState<User | null>(null)
  const [tab, setTab] = useState<UserTab>('home')
  const [jobs, setJobs] = useState<Job[]>(getJobs)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [applyJob, setApplyJob] = useState<Job | null>(null)
  const [applyChannel, setApplyChannel] = useState<'email' | 'whatsapp'>('email')
  const [applyTarget, setApplyTarget] = useState<string>('')
  const [toast, setToast] = useState<string | null>(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifTick, setNotifTick] = useState(0)
  const [recoveryMode, setRecoveryMode] = useState(false)
  void notifTick

  const applyAuthSnapshot = useCallback((snapshot: AuthSnapshot, resetTab = false) => {
    if (snapshot.session.kind === 'admin') {
      if (adminPortal) {
        setUser(null)
        setView('admin')
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
        if (resetTab) setTab('home')
      }
    } else {
      setUser(null)
      setView(adminPortal ? 'admin-login' : 'login')
    }
  }, [adminPortal])

  // Wait for session restoration before showing either login screen. Supabase
  // sends INITIAL_SESSION before the subscription/entitlement query finishes;
  // showing it immediately causes the login screen to flash on refresh.
  useEffect(() => {
    let mounted = true
    let generation = 0
    const restore = (resetTab = false) => {
      const request = ++generation
      void getAuthSnapshot()
        .then((snapshot) => { if (mounted && request === generation) applyAuthSnapshot(snapshot, resetTab) })
        .catch(() => { if (mounted && request === generation) setView(adminPortal ? 'admin-login' : 'login') })
    }
    const unsubscribe = onAuthStateChange((event) => {
      if (!mounted || event === 'INITIAL_SESSION') return
      if (event === 'PASSWORD_RECOVERY') {
        ++generation
        setRecoveryMode(true)
        setUser(null)
        setView(adminPortal ? 'admin-login' : 'login')
      } else if (event === 'SIGNED_OUT') {
        ++generation
        clearPaymentCache()
        setRecoveryMode(false)
        setUser(null)
        setView(adminPortal ? 'admin-login' : 'login')
      } else {
        if (event === 'SIGNED_IN') clearPaymentCache()
        if (event === 'USER_UPDATED') setRecoveryMode(false)
        restore(event === 'SIGNED_IN')
      }
    })
    restore()
    return () => { mounted = false; ++generation; unsubscribe() }
  }, [adminPortal, applyAuthSnapshot])

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

  const unlocked = isSubscribed(user)

  function refreshUser() {
    const u = currentUser()
    if (u) setUser({ ...u })
  }

  function onAuthed() {
    setRecoveryMode(false)
    // SIGNED_IN/USER_UPDATED restores the authenticated view after the
    // server-owned subscription has been loaded.
    setJobs(getJobs())
  }

  async function onLogout() {
    clearPaymentCache()
    await doLogout()
    setRecoveryMode(false)
    setUser(null)
    setView(adminPortal ? 'admin-login' : 'login')
  }

  function openJob(j: Job) {
    setSelectedJob(j)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  if (view === 'loading') {
    return <main role="status" aria-live="polite" className="min-h-screen bg-brand-50 grid place-items-center text-brand-900 font-semibold">Loading your account…</main>
  }

  if (view === 'login') {
    return <LoginScreen onAuthed={onAuthed} recoveryMode={recoveryMode} />
  }

  if (view === 'admin-login') {
    return <AdminLoginScreen onAuthed={onAuthed} recoveryMode={recoveryMode} />
  }

  if (view === 'admin') {
    return <AdminScreen onExit={onLogout} />
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
              <Button variant="accent" onClick={() => setTab('plans')}>
                💎 Subscribe
              </Button>
            )}
          </div>
        }
      />

      {tab === 'home' && user && (
        <HomeScreen
          user={user}
          jobs={jobs}
          onOpenJob={openJob}
          onGoPlans={() => setTab('plans')}
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
        <AccountScreen user={user} onLogout={onLogout} onSubscribed={() => refreshUser()} />
      )}

      <BottomNav active={tab} onChange={(t) => { setTab(t); setJobs(getJobs()) }} />

      <JobDetail
        job={selectedJob}
        unlocked={unlocked}
        onClose={() => setSelectedJob(null)}
        onSubscribe={() => { setSelectedJob(null); setTab('plans') }}
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
        onClose={() => setApplyJob(null)}
        onConfirm={() => {
          if (applyJob && user) {
            const r = openApplication(user, applyJob)
            if (r.ok) {
              showToast(
                r.channel === 'email'
                  ? `Mail app opened — send to ${applyJob.manager || 'manager'} ✉️`
                  : `WhatsApp opened — message ${applyJob.manager || 'manager'} 💬`,
              )
            } else {
              showToast(r.error || 'Could not open application')
            }
          }
          setApplyJob(null)
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
