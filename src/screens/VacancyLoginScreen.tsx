import { useState } from 'react'
import { Button, Card, Input, Label } from '../components/ui'
import { Logo } from '../components/Logo'
import { loginVacancyTeam } from '../data/auth'
import { APP_VERSION_LABEL } from '../data/version'

/**
 * Vacancy team sign-in. Login IDs and passwords are created by the
 * administrator; there is no self-service sign-up or reset on this page.
 */
export function VacancyLoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await loginVacancyTeam(email, password)
      if (!result.ok) setError(result.error)
      else onAuthed()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <header className="mb-6 flex flex-col items-center">
            <div className="hairline grid h-20 w-20 place-items-center rounded-[26px] bg-white shadow-[0_22px_44px_-24px_rgba(16,185,129,0.6)] ring-1 ring-white/70">
              <Logo size={56} />
            </div>
            <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">Vacancy team sign in</h1>
            <p className="mt-1 text-sm font-medium text-slate-600">Post and close vacancies. Nothing else.</p>
            <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-emerald-900 ring-1 ring-emerald-200">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              MedRep Connect Pro · {APP_VERSION_LABEL}
            </span>
          </header>

          <Card className="hairline p-5 backdrop-blur-sm">
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label htmlFor="vacancy-email">Login ID (email)</Label>
                <Input
                  id="vacancy-email"
                  name="vacancy_login_id"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter the login ID from the administrator"
                  autoComplete="username"
                  spellCheck={false}
                  required
                />
              </div>
              <div>
                <Label htmlFor="vacancy-password">Password</Label>
                <Input
                  id="vacancy-password"
                  name="vacancy_password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && <div role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm font-medium px-3 py-2 ring-1 ring-red-300">{error}</div>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Please wait…' : 'Sign in'}
              </Button>
              <p className="text-center text-xs text-slate-600">
                Forgot your password? Ask the administrator to set a new one.
              </p>
            </form>
          </Card>

          <footer className="mt-6 text-center">
            <a href="/" className="text-sm font-semibold text-brand-700 hover:underline">← Back to user sign in</a>
          </footer>
        </div>
      </div>
    </main>
  )
}
