import { useRef, useState } from 'react'
import { Button, Card, Input, Label } from '../components/ui'
import { Logo } from '../components/Logo'
import { CreatorCredit } from '../components/CreatorCredit'
import { loginUser, registerUser, resetPassword, updatePassword } from '../data/auth'
import { CREATOR } from '../data/creator'
import { APP_VERSION_LABEL } from '../data/version'

type Mode = 'signin' | 'signup' | 'forgot' | 'update-password'

export function LoginScreen({ onAuthed, recoveryMode = false }: { onAuthed: () => void; recoveryMode?: boolean }) {
  const [mode, setMode] = useState<Mode>('signin')
  const activeMode: Mode = recoveryMode ? 'update-password' : mode
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const brandTaps = useRef({ count: 0, lastAt: 0 })

  function openRestrictedPortal() {
    const now = Date.now()
    brandTaps.current.count = now - brandTaps.current.lastAt <= 4000 ? brandTaps.current.count + 1 : 1
    brandTaps.current.lastAt = now
    if (brandTaps.current.count !== 5) return
    brandTaps.current.count = 0
    // Convenience entry only. The URL is not secret; Supabase's trusted admin
    // claim and database RLS enforce authorization regardless of navigation.
    const url = new URL(window.location.href)
    url.searchParams.set('portal', 'admin')
    window.location.assign(url.toString())
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setSuccess(null)
    setName('')
    setEmail('')
    setPhone('')
    setPassword('')
    setNewPassword('')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      if (activeMode === 'signup') {
        const result = await registerUser({ name, email, phone, password })
        if (!result.ok) setError(result.error)
        else if (result.confirmationRequired) {
          setSuccess('Check your email for a confirmation link, then sign in.')
          setPassword('')
          setMode('signin')
        } else onAuthed()
      } else if (activeMode === 'signin') {
        const result = await loginUser(email, password)
        if (!result.ok) setError(result.error)
        else onAuthed()
      } else if (activeMode === 'forgot') {
        const result = await resetPassword(email)
        if (!result.ok) setError(result.error)
        else setSuccess('If an account uses that email, password reset instructions have been sent.')
      } else {
        const result = await updatePassword(newPassword)
        if (!result.ok) setError(result.error)
        else {
          setSuccess('Password updated. Signing you in…')
          onAuthed()
        }
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50 via-white to-white flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <header className="flex flex-col items-center mb-6">
            <button type="button" aria-label="MedRep Connect Pro" onClick={openRestrictedPortal} className="rounded-full focus-visible:outline-2 focus-visible:outline-brand-700"><Logo size={64} /></button>
            <div className="mt-3 text-center">
              <h1 className="text-2xl font-extrabold text-slate-900">
                <button type="button" onClick={openRestrictedPortal} className="rounded-md">MedRep <span className="text-brand-700">Connect Pro</span></button>
              </h1>
              <p className="text-sm text-slate-700 mt-1 px-4">{CREATOR.tagline}</p>
              <span className="inline-flex mt-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-300">
                Version {APP_VERSION_LABEL}
              </span>
            </div>
            <div className="mt-4"><CreatorCredit variant="solid" /></div>
          </header>

          <Card className="p-5">
            <p className="text-base font-semibold text-slate-700 mb-4">Sign in to browse openings. New here? Create an account first.</p>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                {activeMode === 'signin' && 'Welcome back'}
                {activeMode === 'signup' && 'Create your account'}
                {activeMode === 'forgot' && 'Reset password'}
                {activeMode === 'update-password' && 'Choose a new password'}
              </h2>
              {activeMode !== 'forgot' && activeMode !== 'update-password' && (
                <button
                  type="button"
                  className="text-sm text-brand-700 font-bold hover:underline"
                  onClick={() => switchMode(activeMode === 'signin' ? 'signup' : 'signin')}
                >
                  {activeMode === 'signin' ? 'Create account' : 'Sign in'}
                </button>
              )}
            </div>

            <form key={activeMode} onSubmit={submit} className="space-y-3">
              {activeMode === 'signup' && (
                <div>
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" name="user_name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required />
                </div>
              )}

              {activeMode !== 'update-password' && (
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="user_email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete={activeMode === 'signin' ? 'username' : 'email'}
                    spellCheck={false}
                    required
                  />
                </div>
              )}

              {activeMode === 'signup' && (
                <div>
                  <Label htmlFor="phone">Mobile (optional)</Label>
                  <Input id="phone" name="user_phone" autoComplete="off" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="10-digit mobile" />
                </div>
              )}

              {activeMode === 'signin' || activeMode === 'signup' ? (
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    name="user_password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={activeMode === 'signup' ? 'At least 12 characters' : 'Enter your password'}
                    autoComplete={activeMode === 'signup' ? 'new-password' : 'current-password'}
                    minLength={activeMode === 'signup' ? 12 : undefined}
                    required
                  />
                </div>
              ) : null}

              {activeMode === 'update-password' && (
                <div>
                  <Label htmlFor="new-password">New password</Label>
                  <Input id="new-password" name="new_password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 12 characters" minLength={12} required />
                </div>
              )}

              {error && <div role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm font-medium px-3 py-2 ring-1 ring-red-300">{error}</div>}
              {success && <div role="status" className="rounded-lg bg-emerald-50 text-emerald-900 text-sm font-medium px-3 py-2 ring-1 ring-emerald-300">{success}</div>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Please wait…' : activeMode === 'signin' ? 'Sign in' : activeMode === 'signup' ? 'Create account' : activeMode === 'forgot' ? 'Send reset link' : 'Update password'}
              </Button>

              {activeMode === 'signin' && (
                <div className="text-center">
                  <button type="button" className="text-sm text-slate-700 font-semibold hover:text-brand-700" onClick={() => switchMode('forgot')}>
                    Forgot password?
                  </button>
                </div>
              )}
              {activeMode === 'forgot' && (
                <div className="text-center">
                  <button type="button" className="text-sm text-slate-700 font-semibold hover:text-brand-700" onClick={() => switchMode('signin')}>
                    Back to sign in
                  </button>
                </div>
              )}
            </form>
          </Card>

          <div className="mt-3 text-center">
            <a
              href="/?portal=vacancy"
              className="inline-block rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-300 hover:bg-brand-50"
            >
              Employee login
            </a>
          </div>

          <footer className="mt-5 text-center">
            <p className="text-sm font-medium text-slate-700">Use Forgot password if you cannot sign in. Never share your password or payment PIN.</p>
          </footer>
        </div>
      </div>
    </main>
  )
}
