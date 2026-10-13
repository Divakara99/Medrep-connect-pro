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
    <main className="min-h-screen bg-gradient-to-b from-emerald-100 via-white to-white flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <header className="flex flex-col items-center mb-6">
            <Logo size={56} />
            <h1 className="mt-3 text-2xl font-extrabold text-slate-900">Vacancy team sign in</h1>
            <span className="inline-flex mt-2 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-900 ring-1 ring-emerald-300">
              MedRep Connect Pro · {APP_VERSION_LABEL}
            </span>
          </header>

          <Card className="p-5">
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
