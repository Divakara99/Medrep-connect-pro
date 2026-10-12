import { useEffect, useState } from 'react'
import { Button, Card, Input, Label } from '../components/ui'
import { Logo } from '../components/Logo'
import { supabase } from '../data/supabase'

type Enrollment = { id: string; qr: string; secret: string }

export function AdminMfaScreen({ onVerified, onExit }: { onVerified: () => void; onExit: () => void }) {
  const [factorId, setFactorId] = useState<string | null>(null)
  const [unverifiedIds, setUnverifiedIds] = useState<string[]>([])
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void supabase.auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (!active) return
      if (listError || !data) setError('Authenticator setup is unavailable. Enable TOTP MFA in Supabase Auth before using the admin panel.')
      else {
        setFactorId(data.totp[0]?.id ?? null)
        setUnverifiedIds(data.all.filter((factor) => factor.factor_type === 'totp' && factor.status !== 'verified').map((factor) => factor.id))
      }
    }).catch(() => { if (active) setError('Cannot reach the authentication service. Try again.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function startEnrollment() {
    setBusy(true)
    setError(null)
    try {
      // An incomplete enrollment cannot be recovered after a page refresh:
      // remove only those unverified factors before creating a fresh QR.
      for (const id of unverifiedIds) {
        // If the server will not remove an incomplete factor at aal1, it
        // must not prevent a new enrollment attempt.
        await supabase.auth.mfa.unenroll({ factorId: id })
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'MedRep admin' })
      if (enrollError || !data) throw enrollError ?? new Error('Enrollment unavailable')
      setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
      setUnverifiedIds([])
    } catch {
      setError('Could not begin authenticator setup. Confirm TOTP is enabled in Supabase and try again.')
    } finally { setBusy(false) }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    const id = enrollment?.id ?? factorId
    if (!id || !/^\d{6}$/.test(code) || busy) return
    setBusy(true)
    setError(null)
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code })
      if (verifyError) {
        setError('Code incorrect or expired. Check your authenticator clock and try again.')
        setCode('')
        return
      }
      setEnrollment(null)
      setCode('')
      onVerified()
    } catch {
      setError('Could not reach the authentication service. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-50 to-white px-4 py-8 grid place-items-center">
      <Card className="w-full max-w-md p-6 space-y-4">
        <div className="flex flex-col items-center text-center gap-2">
          <Logo size={56} />
          <h1 className="text-2xl font-extrabold text-slate-900">Verify administrator access</h1>
          <p className="text-base font-semibold text-slate-700">Your password alone cannot open the admin panel. Enter a six-digit code from your authenticator app.</p>
        </div>
        {loading && <p role="status" className="text-base font-semibold text-slate-700">Checking authenticator…</p>}
        {!loading && !factorId && !enrollment && (
          <div className="space-y-3">
            <p className="text-base text-slate-800">First time? Set up an authenticator app privately. Keep your recovery options safe. Never send the QR, setup key or one-time code to anyone.</p>
            <Button className="w-full" onClick={() => { void startEnrollment() }} disabled={busy}>{busy ? 'Preparing…' : 'Set up authenticator'}</Button>
          </div>
        )}
        {enrollment && (
          <div className="rounded-xl bg-white border border-slate-200 p-4 text-center space-y-2">
            <p className="font-bold text-slate-900">Scan this QR in your authenticator app</p>
            <img src={enrollment.qr} alt="Private authenticator enrollment QR" className="mx-auto w-44 h-44" />
            <p className="text-sm font-semibold text-slate-700">Cannot scan? Enter this key manually in the app:</p>
            <p className="font-mono text-base font-bold text-slate-900 break-all select-all">{enrollment.secret}</p>
            <p className="text-sm font-bold text-red-800">Do not screenshot or share this page.</p>
          </div>
        )}
        {(factorId || enrollment) && (
          <form onSubmit={(event) => { void verify(event) }} className="space-y-3">
            <Label htmlFor="mfa-code">Six-digit authenticator code</Label>
            <Input id="mfa-code" type="text" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and open admin panel'}</Button>
          </form>
        )}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base font-semibold text-red-900">{error}</p>}
        <Button variant="secondary" className="w-full" onClick={onExit}>Sign out</Button>
      </Card>
    </main>
  )
}
