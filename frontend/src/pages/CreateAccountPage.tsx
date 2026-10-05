import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { ApiError, usePageTitle } from '../api'
import { useAuth } from '../auth/useAuth'
import PasswordField from '../components/PasswordField'

const PASSWORD_MIN = 8

export default function CreateAccountPage() {
  usePageTitle('Create Account')
  const { user, signUp } = useAuth()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  // Signing up also signs you in, so a new account lands back on Home.
  if (user) return <Navigate to="/" replace />

  const mismatch = confirm.length > 0 && confirm !== password

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setError('')
    setPending(true)
    try {
      await signUp({ first_name: firstName, last_name: lastName, email, password })
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
        <h1 className="display">Join Campus Customs.</h1>
        <p>Create an account so Dan, our bulldog helper, remembers you and your conversations.</p>
      </div>

      <form className="auth__form" onSubmit={onSubmit}>
        <div className="field-row">
          <label className="field">
            <span className="field__label">First name</span>
            <input
              type="text"
              name="first_name"
              autoComplete="given-name"
              maxLength={60}
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Last name</span>
            <input
              type="text"
              name="last_name"
              autoComplete="family-name"
              maxLength={60}
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              required
            />
          </label>
        </div>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <PasswordField
          id="signup-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          hint={`At least ${PASSWORD_MIN} characters. A short phrase is easy to remember and hard to guess.`}
        />
        <PasswordField
          id="signup-confirm"
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          hint={mismatch ? "Doesn't match yet." : undefined}
        />
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
        <p className="auth__switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </section>
  )
}
