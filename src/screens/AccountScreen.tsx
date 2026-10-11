import { useRef } from 'react'
import { Button, Card, Badge } from '../components/ui'
import { Logo } from '../components/Logo'
import { ProfileEditor, type ProfileEditorHandle } from '../components/ProfileEditor'
import { isSubscribed, type User } from '../data/auth'
import { CREATOR } from '../data/creator'
import { APP_VERSION_LABEL } from '../data/version'

export function AccountScreen({
  user,
  onLogout,
  onSubscribed,
}: {
  user: User
  onLogout: () => void
  onSubscribed: (u: User) => void
}) {
  const unlocked = isSubscribed(user)
  const editorRef = useRef<ProfileEditorHandle>(null)

  return (
    <div className="max-w-3xl mx-auto px-4 pt-4 pb-32 space-y-4">
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

      <ProfileEditor ref={editorRef} email={user.email} onSaved={() => onSubscribed({ ...user })} />

      {/* About card: same brand mark that ships as the PWA icon, plus the
          released version (package.json → build-time constant, never typed twice). */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Logo size={40} />
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900">MedRep Connect Pro</div>
              <div className="text-xs text-slate-500 truncate">{CREATOR.tagline}</div>
            </div>
          </div>
          <Badge color="brand">{APP_VERSION_LABEL}</Badge>
        </div>
      </Card>

      {/* Unified frozen (sticky) action bar: Save primary, Logout secondary.
          Both buttons are anchored together so users don't accidentally hit Logout
          when trying to save, and they can't miss either action. */}
      <div className="fixed bottom-[60px] inset-x-0 z-20 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-2.5">
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
