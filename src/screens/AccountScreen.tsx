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
import { APP_VERSION_LABEL } from '../data/version'

export function AccountScreen({
  user,
  onLogout,
  onSubscribed,
  onProfileSaved,
  onResumeChange,
  onBrowseJobs,
}: {
  user: User
  onLogout: () => void
  onSubscribed: (u: User) => void
  onProfileSaved: (profile: Profile) => void
  onResumeChange: (resume: ResumeRecord | null) => void
  onBrowseJobs: () => void
}) {
  const unlocked = isSubscribed(user)
  const editorRef = useRef<ProfileEditorHandle>(null)
  // "My applications" opens as its own page over this one, so the phone's back
  // button (and its Back button) return here.
  const [applicationsOpen, setApplicationsOpen] = useState(false)

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
      <Card className="p-4 flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white grid place-items-center text-xl font-bold">
          {user.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-slate-900 truncate">{user.name}</div>
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
        <h2 className="font-bold text-slate-900">Subscription validity</h2>
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
          <p className="text-xs text-slate-700 mt-1">{isAndroidApp() ? 'No active plan. Choose a plan to see pricing and pay with Google Play.' : 'No active plan. Choose a plan to see pricing and pay inside Razorpay Checkout.'}</p>
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
          <Badge color="brand">{APP_VERSION_LABEL}</Badge>
        </div>
      </Card>

      {/* Unified frozen (sticky) action bar: Save primary, Logout secondary.
          Both buttons are anchored together so users don't accidentally hit Logout
          when trying to save, and they can't miss either action. */}
      <div
        className="fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur border-t border-slate-200 px-4 pt-2.5"
        style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
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
