import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button, Card } from '../components/ui'
import { Logo } from '../components/Logo'
import { verifyAdminPin, markAdminPinVerified } from '../data/auth'

const PIN_LENGTH = 4

/**
 * Admin access-code gate (box-type digit entry).
 *
 * The historic emailed/authenticator "authentication code" requirement is
 * removed. Access to the admin portal is now: admin email + password
 * (Supabase Auth, role-checked server-side) plus this fixed 4-digit access
 * code shown in box format. The code is an app-level lock only — the real
 * security boundary remains the admin password and the admin role claim.
 */
export function AdminPinScreen({ onVerified, onExit }: { onVerified: () => void; onExit: () => void }) {
  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [error, setError] = useState<string | null>(null)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    inputs.current[0]?.focus()
  }, [])

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    setDigits((current) => {
      const next = [...current]
      next[index] = digit
      return next
    })
    setError(null)
    if (digit && index < PIN_LENGTH - 1) inputs.current[index + 1]?.focus()
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus()
    }
    if (event.key === 'ArrowLeft' && index > 0) inputs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < PIN_LENGTH - 1) inputs.current[index + 1]?.focus()
  }

  function submit(event?: FormEvent) {
    event?.preventDefault()
    const code = digits.join('')
    if (code.length !== PIN_LENGTH) return
    if (!verifyAdminPin(code)) {
      setError('Incorrect access code. Please try again.')
      setDigits(Array(PIN_LENGTH).fill(''))
      inputs.current[0]?.focus()
      return
    }
    markAdminPinVerified()
    onVerified()
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-50 to-white px-4 py-8 grid place-items-center">
      <Card className="w-full max-w-md p-6 space-y-5">
        <div className="flex flex-col items-center text-center gap-2">
          <Logo size={56} />
          <h1 className="text-2xl font-extrabold text-slate-900">Admin access code</h1>
          <p className="text-base font-semibold text-slate-700">
            Enter the 4-digit administrator access code to open the admin panel.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center justify-center gap-3" role="group" aria-label="Four-digit admin access code">
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
                className="w-14 h-16 rounded-2xl border-2 border-slate-300 bg-white text-center text-3xl font-extrabold text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-100"
              />
            ))}
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-base font-semibold text-red-900">{error}</p>
          )}
          <Button type="submit" className="w-full" disabled={digits.some((digit) => !digit)}>
            Open admin panel
          </Button>
        </form>

        <Button variant="secondary" className="w-full" onClick={onExit}>Sign out</Button>
      </Card>
    </main>
  )
}
