import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui'
import { Logo } from '../components/Logo'
import { CreatorCredit } from '../components/CreatorCredit'
import { HowToUseVideoButton } from '../components/HowToUse'
import { isStaffUser, loginUser, registerUser, resetPassword, updatePassword } from '../data/auth'
import { MIN_USER_PASSWORD_LENGTH, minimumForAccount } from '../data/passwordRules'
import { supabase } from '../data/supabase'
import { APP_VERSION_LABEL } from '../data/version'

type Mode = 'signin' | 'signup' | 'forgot' | 'update-password'

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {!visible && <path d="m4 4 16 16" />}
    </svg>
  )
}

export function LoginScreen({ onAuthed, recoveryMode = false }: { onAuthed: () => void; recoveryMode?: boolean }) {
  const [mode, setMode] = useState<Mode>('signin')
  const activeMode: Mode = recoveryMode ? 'update-password' : mode
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // An admin / vacancy-team member can land on THIS page from a reset email
  // (the email link does not know which portal they use). The minimum is
  // resolved from the recovery session's real role, never assumed from the
  // page — both rules are 6 today, and this keeps it correct if staff ever
  // diverge again.
  const [recoveryIsStaff, setRecoveryIsStaff] = useState(false)
  const recoveryMinimum = minimumForAccount(recoveryIsStaff)
  const brandTaps = useRef({ count: 0, lastAt: 0 })

  useEffect(() => {
    if (!recoveryMode) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setRecoveryIsStaff(isStaffUser(data.session?.user))
    })
    return () => { active = false }
  }, [recoveryMode])

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
    setShowPassword(false)
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
        const result = await updatePassword(newPassword, recoveryMinimum)
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
    <main data-login-shell className="auth-login-screen flex min-h-full flex-col text-white">
      {/* Keep the form at the top on phones so opening the keyboard never
          recentres the screen; centre it on wider screens like the reference. */}
      <div className="flex flex-1 items-start justify-center px-6 pb-8 pt-7 sm:items-center sm:pt-8">
        <div className="w-full max-w-md">
        <header className="flex w-full flex-col items-center text-center">
          <button
            type="button"
            aria-label="MedRep Connect Pro"
            onClick={openRestrictedPortal}
            className="grid h-16 w-16 place-items-center rounded-xl bg-transparent transition active:scale-95 focus-visible:outline-2 focus-visible:outline-white"
          >
            <Logo size={64} />
          </button>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white">
            <button type="button" onClick={openRestrictedPortal} className="rounded-md">
              MedRep <span className="text-sky-100">Connect Pro</span>
            </button>
          </h1>
          <p className="mt-1 w-full whitespace-nowrap text-[11px] font-medium tracking-tight text-white/85">India&apos;s pharma &amp; multi-industry jobs</p>
          <h2 className="mt-6 text-center text-lg font-light uppercase tracking-[0.22em] text-white">
            {activeMode === 'signin' && 'Job seeker login'}
            {activeMode === 'signup' && 'Create account'}
            {activeMode === 'forgot' && 'Reset password'}
            {activeMode === 'update-password' && 'New password'}
          </h2>
        </header>

        <section className="mt-4 w-full" aria-label="Sign in">
          <p className="mb-3 text-center text-sm font-medium text-white/85">
            {activeMode === 'signin' && 'Sign in to browse openings.'}
            {activeMode === 'signup' && 'Create an account to browse openings.'}
            {activeMode === 'forgot' && 'Enter your email to request a reset link.'}
            {activeMode === 'update-password' && 'Choose a secure new password.'}
          </p>
          {activeMode !== 'forgot' && activeMode !== 'update-password' && (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                className="text-sm font-bold text-white underline decoration-white/60 underline-offset-4 hover:decoration-white"
                onClick={() => switchMode(activeMode === 'signin' ? 'signup' : 'signin')}
              >
                {activeMode === 'signin' ? 'Create account' : 'Sign in'}
              </button>
            </div>
          )}

          <form key={activeMode} onSubmit={submit} className="space-y-4">
            {activeMode === 'signup' && (
              <div className="relative rounded-xl border border-white/80 bg-white/95 px-3 shadow-sm transition focus-within:ring-2 focus-within:ring-white">
                <label className="sr-only" htmlFor="name">Full name</label>
                <input id="name" name="user_name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" required className="w-full bg-transparent py-3 text-base font-semibold text-[#073b7d] placeholder:text-slate-500 outline-none focus:ring-0" />
              </div>
            )}

            {activeMode !== 'update-password' && (
              <div className="relative rounded-xl border border-white/80 bg-white/95 px-3 shadow-sm transition focus-within:ring-2 focus-within:ring-white">
                <label className="sr-only" htmlFor="email">Email</label>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#073b7d]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" />
                </svg>
                <input id="email" name="user_email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email ID" autoComplete={activeMode === 'signin' ? 'username' : 'email'} spellCheck={false} required className="w-full bg-transparent py-3 pl-8 text-base font-semibold text-[#073b7d] placeholder:text-slate-500 outline-none focus:ring-0" />
              </div>
            )}

            {activeMode === 'signup' && (
              <div className="relative rounded-xl border border-white/80 bg-white/95 px-3 shadow-sm transition focus-within:ring-2 focus-within:ring-white">
                <label className="sr-only" htmlFor="phone">Mobile (optional)</label>
                <input id="phone" name="user_phone" autoComplete="off" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="10-digit mobile (optional)" className="w-full bg-transparent py-3 text-base font-semibold text-[#073b7d] placeholder:text-slate-500 outline-none focus:ring-0" />
              </div>
            )}

            {activeMode === 'signin' || activeMode === 'signup' ? (
              <div className="relative rounded-xl border border-white/80 bg-white/95 px-3 shadow-sm transition focus-within:ring-2 focus-within:ring-white">
                <label className="sr-only" htmlFor="password">Password</label>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#073b7d]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
                </svg>
                <input id="password" name="user_password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={activeMode === 'signup' ? `Password · at least ${MIN_USER_PASSWORD_LENGTH} characters` : 'Password'} autoComplete={activeMode === 'signup' ? 'new-password' : 'current-password'} minLength={activeMode === 'signup' ? MIN_USER_PASSWORD_LENGTH : undefined} required className="w-full bg-transparent py-3 pl-8 pr-12 text-base font-semibold text-[#073b7d] placeholder:text-slate-500 outline-none focus:ring-0" />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-[#073b7d] ring-1 ring-slate-300 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <PasswordVisibilityIcon visible={showPassword} />
                </button>
              </div>
            ) : null}

            {activeMode === 'update-password' && (
              <div className="relative rounded-xl border border-white/80 bg-white/95 px-3 shadow-sm transition focus-within:ring-2 focus-within:ring-white">
                <label className="sr-only" htmlFor="new-password">New password</label>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#073b7d]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
                </svg>
                <input id="new-password" name="new_password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={`New password · at least ${recoveryMinimum} characters`} minLength={recoveryMinimum} required className="w-full bg-transparent py-3 pl-8 pr-12 text-base font-semibold text-[#073b7d] placeholder:text-slate-500 outline-none focus:ring-0" />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-[#073b7d] ring-1 ring-slate-300 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <PasswordVisibilityIcon visible={showPassword} />
                </button>
              </div>
            )}

            {error && <div role="alert" className="rounded-xl bg-rose-50/95 px-3.5 py-2.5 text-sm font-semibold text-rose-800 ring-1 ring-rose-200">{error}</div>}
            {success && <div role="status" className="rounded-xl bg-emerald-50/95 px-3.5 py-2.5 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200">{success}</div>}

            <div className="flex items-center justify-end pt-1">
              {activeMode === 'signin' && (
                <button type="button" className="text-sm font-semibold text-white/90 underline decoration-white/50 underline-offset-4 hover:text-white" onClick={() => switchMode('forgot')}>
                  Forgot password?
                </button>
              )}
              {activeMode === 'forgot' && (
                <button type="button" className="text-sm font-semibold text-white/90 underline underline-offset-4 hover:text-white" onClick={() => switchMode('signin')}>
                  Back to sign in
                </button>
              )}
            </div>

            <Button
              type="submit"
              className="w-full py-3.5 text-sm uppercase tracking-[0.2em] text-white ring-0 shadow-lg shadow-blue-950/25 hover:brightness-110"
              style={{ backgroundColor: '#073b7d', backgroundImage: 'none' }}
              disabled={loading}
            >
              {loading ? 'Please wait…' : activeMode === 'signin' ? 'Login' : activeMode === 'signup' ? 'Create account' : activeMode === 'forgot' ? 'Send reset link' : 'Update password'}
            </Button>
          </form>
        </section>

        <div className="mt-3 grid w-full grid-cols-2 items-stretch gap-1.5">
          <HowToUseVideoButton className="min-h-9 min-w-0 gap-1.5 rounded-xl px-1.5 py-1 text-[11px] font-extrabold !leading-tight !bg-white !text-[#073b7d] !ring-white [&_svg]:h-4 [&_svg]:w-4" />
          <a href="/?portal=vacancy" className="inline-flex min-h-9 min-w-0 items-center justify-center rounded-xl border-2 border-white bg-white px-1.5 py-1 text-center text-[11px] font-extrabold leading-tight text-[#073b7d] shadow-sm transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-700">
            Employee login
          </a>
        </div>
        <div className="mt-2"><CreatorCredit variant="dark" size="sm" /></div>
        <footer className="mt-3 w-full text-center">
          <p className="text-xs font-medium text-white/85">Use Forgot password if you cannot sign in. Never share your password or payment PIN.</p>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/70">Version {APP_VERSION_LABEL}</p>
        </footer>
        </div>
      </div>
    </main>
  )
}
