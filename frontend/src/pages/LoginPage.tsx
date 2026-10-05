import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { ApiError, usePageTitle } from '../api'
import { useAuth } from '../auth/useAuth'
import PasswordField from '../components/PasswordField'

export default function LoginPage() {
  usePageTitle('Log in')
  const { user, logIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  // Already signed in (or just signed in): nothing to do here.
  if (user) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      await logIn(email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't reach the shop. Please try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="auth">
      <div className="auth__panel">
        <p className="eyebrow eyebrow--light">Account</p>
        <h1 className="display">Welcome back.</h1>
        <p>Log in to pick up where you left off with Dan, our bulldog helper.</p>
      </div>

      <form className="auth__form" onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <PasswordField
          id="login-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Logging in…' : 'Log in'}
        </button>
        <p className="auth__switch">
          New here? <Link to="/create-account">Create an account</Link>
        </p>
      </form>
    </section>
  )
}
