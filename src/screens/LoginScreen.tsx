import { useEffect, useRef, useState } from 'react'
import { Button, Card, Input, Label } from '../components/ui'
import { Logo } from '../components/Logo'
import { CreatorCredit } from '../components/CreatorCredit'
import { loginAdmin, loginUser, registerUser, resetPassword } from '../data/auth'
import { CREATOR } from '../data/creator'
import { APP_VERSION_LABEL } from '../data/version'

type Mode = 'signin' | 'signup' | 'forgot' | 'admin'

export function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [logoTaps, setLogoTaps] = useState(0)
  const tapTimer = useRef<number | null>(null)

  // form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Never allow browser autofill to leak saved admin (or any) credentials
  // into this form — wipe fields on mount and on every mode switch.
  useEffect(() => {
    clearFields()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clearFields() {
    setName('')
    setEmail('')
    setPhone('')
    setPassword('')
    setNewPassword('')
  }

  function handleLogoTap() {
    if (mode === 'admin') return
    const next = logoTaps + 1
    setLogoTaps(next)
    if (tapTimer.current) window.clearTimeout(tapTimer.current)
    tapTimer.current = window.setTimeout(() => setLogoTaps(0), 1500)
    if (next >= 5) {
      setLogoTaps(0)
      setMode('admin')
      setError(null)
      setSuccess(null)
      // Never prefill admin credentials — admin types the email themselves
      clearFields()
    }
  }

  function switchMode(m: Mode) {
    setMode(m)
    setError(null)
    setSuccess(null)
    clearFields()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    setTimeout(() => {
      if (mode === 'signup') {
        const r = registerUser({ name, email, phone, password })
        if (!r.ok) setError(r.error)
        else onAuthed()
      } else if (mode === 'signin') {
        const r = loginUser(email, password)
        if (!r.ok) setError(r.error)
        else onAuthed()
      } else if (mode === 'admin') {
        const r = loginAdmin(email, password)
        if (!r.ok) setError(r.error)
        else onAuthed()
      } else if (mode === 'forgot') {
        const r = resetPassword(email, newPassword)
        if (!r.ok) setError(r.error)
        else {
          setSuccess('Password reset successfully (local demo). You can sign in now.')
          setMode('signin')
          setNewPassword('')
        }
      }
      setLoading(false)
    }, 250)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 via-white to-white flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-6">
            <button onClick={handleLogoTap} className="select-none" aria-label="Tap logo">
              <Logo size={64} />
            </button>
            <div className="mt-3 text-center">
              <div className="text-xl font-extrabold text-slate-900">
                MedRep <span className="text-brand-600">Connect Pro</span>
              </div>
              <div className="text-xs text-slate-500 mt-1 px-4">
                {CREATOR.tagline}
              </div>
              <div className="mt-2">
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                  Version {APP_VERSION_LABEL}
                </span>
              </div>
            </div>
            <div className="mt-4">
              <CreatorCredit variant="solid" />
            </div>
          </div>

          <Card className="p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                {mode === 'signin' && 'Welcome back'}
                {mode === 'signup' && 'Create your account'}
                {mode === 'forgot' && 'Reset password'}
                {mode === 'admin' && 'Admin sign in'}
              </h2>
              {mode !== 'admin' && mode !== 'forgot' && (
                <button
                  type="button"
                  className="text-xs text-brand-600 font-semibold hover:underline"
                  onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                >
                  {mode === 'signin' ? 'Create account' : 'Sign in'}
                </button>
              )}
            </div>

            <form key={mode} onSubmit={submit} className="space-y-3" autoComplete="off">
              {mode === 'signup' && (
                <div>
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" name="us_nm" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
                </div>
              )}

              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name={mode === 'admin' ? 'ad_em' : 'us_em'}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={mode === 'admin' ? 'Enter admin email' : 'you@example.com'}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </div>

              {mode === 'signup' && (
                <div>
                  <Label htmlFor="phone">Mobile (optional)</Label>
                  <Input id="phone" name="us_ph" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
                </div>
              )}

              {mode !== 'forgot' && (
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    name={mode === 'admin' ? 'ad_pw' : 'us_pw'}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    autoComplete={mode === 'admin' ? 'new-password' : 'off'}
                    required
                  />
                </div>
              )}

              {mode === 'forgot' && (
                <div>
                  <Label htmlFor="newpass">New password</Label>
                  <Input id="newpass" name="us_np" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" required />
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2 ring-1 ring-red-200">{error}</div>
              )}
              {success && (
                <div className="rounded-lg bg-emerald-50 text-emerald-700 text-sm px-3 py-2 ring-1 ring-emerald-200">{success}</div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Reset password' : 'Enter admin panel'}
              </Button>

              {mode === 'signin' && (
                <div className="text-center">
                  <button type="button" className="text-xs text-slate-500 hover:text-brand-600" onClick={() => switchMode('forgot')}>
                    Forgot password?
                  </button>
                </div>
              )}
              {mode === 'forgot' && (
                <div className="text-center">
                  <button type="button" className="text-xs text-slate-500 hover:text-brand-600" onClick={() => switchMode('signin')}>
                    Back to sign in
                  </button>
                </div>
              )}
              {mode === 'admin' && (
                <div className="text-center">
                  <button type="button" className="text-xs text-slate-500 hover:text-brand-600" onClick={() => switchMode('signin')}>
                    Back to user sign in
                  </button>
                </div>
              )}
            </form>
          </Card>

          <div className="mt-6 text-center space-y-2">
            <CreatorCredit variant="light" />
            <div className="text-[11px] text-slate-400">
              App created by <span className="font-semibold text-slate-600">Mr. {CREATOR.name}</span> · {CREATOR.role}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
