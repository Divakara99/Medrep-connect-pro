import { useState } from 'react'
import { Button, Card, Input, Label } from '../components/ui'
import { Logo } from '../components/Logo'
import { CreatorCredit } from '../components/CreatorCredit'
import { loginAdmin, resetPassword, updatePassword } from '../data/auth'
import { CREATOR } from '../data/creator'
import { APP_VERSION_LABEL } from '../data/version'

type Mode = 'signin' | 'forgot' | 'update-password'

export function AdminLoginScreen({
  onAuthed,
  recoveryMode = false,
}: {
  onAuthed: () => void
  recoveryMode?: boolean
}) {
  const [mode, setMode] = useState<Mode>('signin')
  const activeMode: Mode = recoveryMode ? 'update-password' : mode
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setEmail('')
    setPassword('')
    setNewPassword('')
    setError(null)
    setSuccess(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      if (activeMode === 'signin') {
        const result = await loginAdmin(email, password)
        if (!result.ok) setError(result.error)
        else onAuthed()
      } else if (activeMode === 'forgot') {
        const result = await resetPassword(email)
        if (!result.ok) setError(result.error)
        else setSuccess('If this address is an admin account, reset instructions have been sent.')
      } else {
        const result = await updatePassword(newPassword)
        if (!result.ok) setError(result.error)
        else {
          setSuccess('Password updated. Signing you in…')
          onAuthed()
        }
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Admin sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-100 via-white to-white flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <header className="flex flex-col items-center mb-6">
            <Logo size={64} />
            <div className="mt-3 text-center">
              <h1 className="text-2xl font-extrabold text-slate-900">
                MedRep <span className="text-brand-700">Connect Pro</span>
              </h1>
              <p className="text-sm text-slate-700 mt-1">Restricted administrator access</p>
              <span className="inline-flex mt-2 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-900 ring-1 ring-indigo-300">
                Admin portal · {APP_VERSION_LABEL}
              </span>
            </div>
            <div className="mt-4"><CreatorCredit variant="solid" /></div>
          </header>

          <Card className="p-5">
            <h2 className="text-lg font-bold text-slate-900 mb-4">
              {activeMode === 'signin' ? 'Admin sign in' : activeMode === 'forgot' ? 'Reset admin password' : 'Choose a new password'}
            </h2>
            <form key={activeMode} onSubmit={submit} className="space-y-3">
              {activeMode !== 'update-password' && (
                <div>
                  <Label htmlFor="admin-email">Admin email</Label>
                  <Input
                    id="admin-email"
                    name="admin_email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Enter admin email"
                    autoComplete={activeMode === 'signin' ? 'username' : 'email'}
                    spellCheck={false}
                    required
                  />
                </div>
              )}
              {activeMode === 'signin' && (
                <div>
                  <Label htmlFor="admin-password">Password</Label>
                  <Input
                    id="admin-password"
                    name="admin_password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Admin password"
                    autoComplete="current-password"
                    required
                  />
                </div>
              )}
              {activeMode === 'update-password' && (
                <div>
                  <Label htmlFor="admin-new-password">New password</Label>
                  <Input
                    id="admin-new-password"
                    name="admin_new_password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    minLength={6}
                    required
                  />
                </div>
              )}
              {error && <div role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm font-medium px-3 py-2 ring-1 ring-red-300">{error}</div>}
              {success && <div role="status" className="rounded-lg bg-emerald-50 text-emerald-900 text-sm font-medium px-3 py-2 ring-1 ring-emerald-300">{success}</div>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Please wait…' : activeMode === 'signin' ? 'Enter admin panel' : activeMode === 'forgot' ? 'Send reset link' : 'Update password'}
              </Button>
              {activeMode === 'signin' && (
                <div className="text-center">
                  <button type="button" className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => switchMode('forgot')}>
                    Forgot password?
                  </button>
                </div>
              )}
              {activeMode === 'forgot' && (
                <div className="text-center">
                  <button type="button" className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => switchMode('signin')}>
                    Back to admin sign in
                  </button>
                </div>
              )}
            </form>
          </Card>

          <footer className="mt-6 text-center space-y-2">
            <a href="/" className="text-sm font-semibold text-brand-700 hover:underline">← Back to user sign in</a>
            <div><CreatorCredit variant="light" /></div>
            <p className="text-xs text-slate-700">App created by <span className="font-semibold">Mr. {CREATOR.name}</span> · {CREATOR.role}</p>
          </footer>
        </div>
      </div>
    </main>
  )
}
