import { useEffect, useState } from 'react'
import { LoginScreen } from './screens/LoginScreen'
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

type View = 'login' | 'user' | 'admin'

export default function App() {
  const [view, setView] = useState<View>('login')
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

  function applyAuthSnapshot(snapshot: AuthSnapshot, resetTab = false) {
    if (snapshot.session.kind === 'admin') {
      setUser(null)
      setView('admin')
    } else if (snapshot.session.kind === 'user' && snapshot.user) {
      setUser(snapshot.user)
      setView('user')
      if (resetTab) setTab('home')
    } else {
      setUser(null)
      setView('login')
    }
  }

  // Restore and observe the Supabase Auth session; the former localStorage
  // session is intentionally ignored and cleared by the auth module.
  useEffect(() => {
    let mounted = true
    const unsubscribe = onAuthStateChange((event, snapshot) => {
      if (!mounted) return
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
        setUser(null)
        setView('login')
        return
      }
      if (event === 'SIGNED_OUT') {
        setRecoveryMode(false)
        setUser(null)
        setView('login')
        return
      }
      if (event === 'USER_UPDATED') setRecoveryMode(false)
      applyAuthSnapshot(snapshot, event === 'SIGNED_IN')
    })
    void getAuthSnapshot()
      .then((snapshot) => { if (mounted) applyAuthSnapshot(snapshot) })
      .catch(() => { if (mounted) setView('login') })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const unlocked = isSubscribed(user)

  function refreshUser() {
    const u = currentUser()
    if (u) setUser({ ...u })
  }

  function onAuthed() {
    setRecoveryMode(false)
    void getAuthSnapshot()
      .then((snapshot) => applyAuthSnapshot(snapshot, true))
      .catch(() => setView('login'))
    setJobs(getJobs())
  }

  async function onLogout() {
    await doLogout()
    setRecoveryMode(false)
    setUser(null)
    setView('login')
  }

  function openJob(j: Job) {
    setSelectedJob(j)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  if (view === 'login') {
    return <LoginScreen onAuthed={onAuthed} recoveryMode={recoveryMode} />
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
        <PlansScreen user={user} onSubscribed={(u) => { setUser(u); refreshUser(); showToast('Welcome to Pro!') }} />
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
