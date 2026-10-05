import { useState } from 'react'

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  minLength?: number
  hint?: string
}

/** A password input with its own Show / Hide toggle. */
export default function PasswordField({ id, label, value, onChange, autoComplete, minLength, hint }: Props) {
  const [visible, setVisible] = useState(false)
  const hintId = hint ? `${id}-hint` : undefined

  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <div className="password-input">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={128}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hintId}
          required
        />
        <button
          type="button"
          className="password-input__toggle"
          onClick={() => setVisible((shown) => !shown)}
          aria-controls={id}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      )}
    </div>
  )
}
