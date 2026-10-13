import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button, Card } from '../components/ui'
import { Logo } from '../components/Logo'
import { enrollTotp, listTotpFactors, unenrollTotp, verifyTotp, type TotpEnrollment, type TotpFactor } from '../data/mfa'

const CODE_LENGTH = 6

/**
 * Administrator authenticator (TOTP) gate.
 *
 * Sign-in is admin email + password; this screen completes the second factor.
 * Supabase Auth issues the `aal2` session claim only after a code is accepted
 * here, and every admin-only RLS policy and Edge Function requires it — so this
 * step is the real authorization boundary for admin data, not a UI convenience.
 */
export function AdminMfaScreen({ onVerified, onExit }: { onVerified: () => void; onExit: () => void }) {
  const [loading, setLoading] = useState(true)
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [factors, setFactors] = useState<TotpFactor[]>([])
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  const loadFactors = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const existing = await listTotpFactors()
      setFactors(existing)
      const verified = existing.some((factor) => factor.status === 'verified')
      if (!verified) {
        const result = await enrollTotp()
        if (!result.ok) {
          setError(`${result.error} Authenticator (TOTP) sign-in must be enabled for this project in Supabase → Authentication before the admin panel can be opened.`)
        } else {
          setEnrollment(result.enrollment)
        }
      } else {
        setEnrollment(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the authenticator service.')
    } finally {
      setLoading(false)
      inputs.current[0]?.focus()
    }
  }, [])

  useEffect(() => { queueMicrotask(() => { void loadFactors() }) }, [loadFactors])

  function setDigit(index: number, value: string) {
    // Pasting a whole code fills every box at once.
    const pasted = value.replace(/\D/g, '')
    if (pasted.length > 1) {
      const next = Array(CODE_LENGTH).fill('')
      pasted.slice(0, CODE_LENGTH).split('').forEach((digit, offset) => { next[offset] = digit })
      setDigits(next)
      inputs.current[Math.min(pasted.length, CODE_LENGTH) - 1]?.focus()
      setError(null)
      return
    }
    setDigits((current) => {
      const next = [...current]
      next[index] = pasted
      return next
    })
    setError(null)
    if (pasted && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus()
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) inputs.current[index - 1]?.focus()
    if (event.key === 'ArrowLeft' && index > 0) inputs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus()
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const factorId = enrollment?.factorId ?? factors.find((factor) => factor.status === 'verified')?.id
    if (!factorId || busy) return
    const code = digits.join('')
    if (code.length !== CODE_LENGTH) {
      setError('Enter all six digits from your authenticator app.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await verifyTotp(factorId, code)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      setDigits(Array(CODE_LENGTH).fill(''))
      inputs.current[0]?.focus()
      return
    }
    // The session is now aal2; the app reloads the admin snapshot.
    onVerified()
  }

  async function removeUnverifiedFactor() {
    if (!enrollment || busy) return
    setBusy(true)
    await unenrollTotp(enrollment.factorId)
    setEnrollment(null)
    setDigits(Array(CODE_LENGTH).fill(''))
    await loadFactors()
    setBusy(false)
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-50 to-white px-4 py-8 grid place-items-center">
      <Card className="w-full max-w-md p-6 space-y-5">
        <div className="flex flex-col items-center text-center gap-2">
          <Logo size={56} />
          <h1 className="text-2xl font-extrabold text-slate-900">Authenticator verification</h1>
          <p className="text-sm font-semibold text-slate-700">
            {enrollment
              ? 'Set up two-step verification with an authenticator app (Google Authenticator, Authy, Microsoft Authenticator).'
              : 'Enter the six-digit code from your authenticator app to open the admin panel.'}
          </p>
        </div>

        {loading ? (
          <div role="status" className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">
            Checking authenticator settings…
          </div>
        ) : (
          <>
            {enrollment && (
              <div className="rounded-xl ring-1 ring-slate-200 p-3 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">1 · Scan this code</div>
                {/* Supabase returns the QR as an inline SVG data URI. */}
                <img src={enrollment.qrCode} alt="Authenticator QR code" className="mx-auto w-44 h-44 rounded-lg bg-white ring-1 ring-slate-200" />
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Or enter the key manually</div>
                <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 font-mono text-xs text-slate-800 break-all">
                  {showSecret ? enrollment.secret : '••••••••••••••••'}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setShowSecret((value) => !value)}>
                    {showSecret ? 'Hide key' : 'Show key'}
                  </button>
                  <button type="button" className="text-xs font-semibold text-slate-600 hover:underline" disabled={busy} onClick={() => { void removeUnverifiedFactor() }}>
                    Restart setup
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {enrollment ? '2 · Enter the code it shows' : 'Six-digit code'}
              </div>
              <div className="flex items-center justify-center gap-2" role="group" aria-label="Six-digit authenticator code">
                {digits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(element) => { inputs.current[index] = element }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Digit ${index + 1}`}
                    value={digit}
                    onChange={(event) => setDigit(index, event.target.value)}
                    onKeyDown={(event) => onKeyDown(index, event)}
                    className="w-11 h-14 rounded-2xl border-2 border-slate-300 bg-white text-center text-2xl font-extrabold text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-100"
                  />
                ))}
              </div>
              {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy || digits.some((digit) => !digit)}>
                {busy ? 'Verifying…' : enrollment ? 'Verify and enable' : 'Open admin panel'}
              </Button>
            </form>

            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
              <p>Administrator data requires a verified authenticator while the sign-in code is ON. A password-only session cannot read vacancies, users, payments or pricing.</p>
              <p>Codes expire every 30 seconds — if one is rejected, wait for the next. Codes are never stored on this device.</p>
              <p>Lost the authenticator? An administrator who is already signed in can turn the sign-in code OFF in the admin panel → 🔐 Security (it is audited, and it can be switched back on at any time). After that, use the button below to continue without the code.</p>
            </div>

            <Button
              variant="secondary"
              className="w-full"
              onClick={() => onVerified()}
            >
              The code was switched OFF for me — check again
            </Button>

            <div className="text-xs text-slate-500">
              {hasVerifiedTotpFactorLabel(factors)}
            </div>
          </>
        )}

        <Button variant="secondary" className="w-full" onClick={onExit}>Sign out</Button>
      </Card>
    </main>
  )
}

function hasVerifiedTotpFactorLabel(factors: TotpFactor[]): string {
  const verified = factors.filter((factor) => factor.status === 'verified').length
  const pending = factors.filter((factor) => factor.status !== 'verified').length
  if (verified === 0 && pending === 0) return 'No authenticator enrolled yet.'
  return `${verified} verified authenticator${verified === 1 ? '' : 's'}${pending ? ` · ${pending} awaiting first verification` : ''}`
}
