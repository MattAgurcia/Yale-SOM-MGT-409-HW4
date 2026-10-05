import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, LOW_STOCK, getSizeAdvice, type FitPreference, type Product, type SizeAdvice } from '../api'
import { useCart } from '../cart/cartContext'
import { flyToCart } from '../cart/flyToCart'
import { CloseIcon, RulerIcon } from './Icons'

type Units = 'us' | 'metric'

interface Measurements {
  units: Units
  feet: string
  inches: string
  pounds: string
  cm: string
  kg: string
  chest: string
  fit: FitPreference
}

// Kept for this tab only (not stored), so reopening the helper on another product is one click.
let remembered: Measurements = {
  units: 'us',
  feet: '',
  inches: '',
  pounds: '',
  cm: '',
  kg: '',
  chest: '',
  fit: 'regular',
}
const remember = (m: Measurements) => {
  remembered = m
}

const FITS: { value: FitPreference; label: string; hint: string }[] = [
  { value: 'snug', label: 'Snug', hint: 'Close to the body' },
  { value: 'regular', label: 'Regular', hint: 'True to size' },
  { value: 'relaxed', label: 'Relaxed', hint: 'Roomy, oversized' },
]

const number = (text: string) => (text.trim() === '' ? NaN : Number(text))

/** The form in US units for POST /api/size-advice, or an error message. */
function toRequest(m: Measurements): { height_in: number; weight_lb: number; chest_in: number | null } | string {
  const chestRaw = number(m.chest)
  if (m.units === 'us') {
    const height = number(m.feet) * 12 + (number(m.inches) || 0)
    const weight = number(m.pounds)
    if (!(height >= 48 && height <= 90)) return 'Please enter your height in feet and inches (for example 5 ft 10 in).'
    if (!(weight >= 70 && weight <= 400)) return 'Please enter your weight in pounds (70–400 lb).'
    return { height_in: height, weight_lb: weight, chest_in: Number.isFinite(chestRaw) ? chestRaw : null }
  }
  const height = number(m.cm) / 2.54
  const weight = number(m.kg) * 2.20462
  if (!(height >= 48 && height <= 90)) return 'Please enter your height in centimetres (122–228 cm).'
  if (!(weight >= 70 && weight <= 400)) return 'Please enter your weight in kilograms (32–180 kg).'
  return { height_in: height, weight_lb: weight, chest_in: Number.isFinite(chestRaw) ? chestRaw / 2.54 : null }
}

interface Props {
  open: boolean
  onClose: () => void
  /** The product being sized, for its fit and stock; null on the shop page. */
  product?: Product | null
  /** "Choose this size": selects it on the product page, or filters the shop by it. */
  onChoose?: (size: string) => void
  chooseLabel?: (size: string) => string
}

/**
 * The size & fit helper. Height, weight, optional chest and how you like it to
 * fit go to POST /api/size-advice (backend/tools.py, which reads the shop's
 * size chart and fit notes from the database); the answer comes back with the
 * reasoning, the garment's fit and, for a product, live stock in that size.
 */
export default function SizeHelper({ open, onClose, product = null, onChoose, chooseLabel }: Props) {
  const cart = useCart()
  const [form, setForm] = useState<Measurements>(remembered)
  const [advice, setAdvice] = useState<SizeAdvice | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  // The latest onClose, so a parent re-render doesn't re-run the open effect (and steal focus).
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    document.body.classList.add('has-overlay')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.classList.remove('has-overlay')
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null

  const update = (patch: Partial<Measurements>) => {
    const next = { ...form, ...patch }
    remember(next)
    setForm(next)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const body = toRequest(form)
    if (typeof body === 'string') {
      setError(body)
      return
    }
    setError('')
    setPending(true)
    try {
      setAdvice(await getSizeAdvice({ ...body, fit: form.fit, product_id: product?.product_id ?? null }))
    } catch (err) {
      setError(
        err instanceof ApiError && err.status !== 422 ? err.message : 'Please check your measurements and try again.',
      )
    } finally {
      setPending(false)
    }
  }

  function addToCart(size: string, event: MouseEvent<HTMLButtonElement>) {
    if (product && cart.add(product, size) > 0) flyToCart(event.currentTarget)
  }

  const stockLine = (size: string, quantity: number | null) => {
    if (quantity === null) return null
    if (quantity === 0) return { text: `${size} is sold out in this style`, tone: 'out' }
    if (quantity <= LOW_STOCK) return { text: `Only ${quantity} left in ${size}`, tone: 'low' }
    return { text: `${quantity} in stock in ${size}`, tone: 'in' }
  }
  const main = advice && stockLine(advice.size, advice.quantity)
  const alt = advice?.alternative ? stockLine(advice.alternative, advice.alternative_quantity) : null

  return createPortal(
    <div className="modal-layer">
      <button type="button" className="drawer-scrim" aria-label="Close size helper" tabIndex={-1} onClick={onClose} />
      <div
        ref={dialogRef}
        className="modal size-helper"
        role="dialog"
        aria-modal="true"
        aria-labelledby="size-helper-title"
        data-cart-source
      >
        <header className="modal__head">
          <span className="modal__icon">{product ? <img src={product.image_url} alt="" /> : <RulerIcon />}</span>
          <div>
            <h2 id="size-helper-title">Find my size</h2>
            <p>{product ? product.name : 'Unisex sizes XS–XXL, from our size chart'}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close size helper" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        {!advice ? (
          <form className="size-helper__form" onSubmit={submit} noValidate>
            <div className="segmented" role="radiogroup" aria-label="Units">
              {(['us', 'metric'] as Units[]).map((units) => (
                <button
                  key={units}
                  type="button"
                  role="radio"
                  aria-checked={form.units === units}
                  className={form.units === units ? 'is-active' : ''}
                  onClick={() => update({ units })}
                >
                  {units === 'us' ? 'ft · lb' : 'cm · kg'}
                </button>
              ))}
            </div>

            {form.units === 'us' ? (
              <div className="field-row field-row--three">
                <label className="field">
                  <span className="field__label">Height (ft)</span>
                  <input
                    inputMode="numeric"
                    value={form.feet}
                    onChange={(e) => update({ feet: e.target.value })}
                    placeholder="5"
                  />
                </label>
                <label className="field">
                  <span className="field__label">(in)</span>
                  <input
                    inputMode="numeric"
                    value={form.inches}
                    onChange={(e) => update({ inches: e.target.value })}
                    placeholder="10"
                  />
                </label>
                <label className="field">
                  <span className="field__label">Weight (lb)</span>
                  <input
                    inputMode="numeric"
                    value={form.pounds}
                    onChange={(e) => update({ pounds: e.target.value })}
                    placeholder="165"
                  />
                </label>
              </div>
            ) : (
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Height (cm)</span>
                  <input
                    inputMode="numeric"
                    value={form.cm}
                    onChange={(e) => update({ cm: e.target.value })}
                    placeholder="178"
                  />
                </label>
                <label className="field">
                  <span className="field__label">Weight (kg)</span>
                  <input
                    inputMode="numeric"
                    value={form.kg}
                    onChange={(e) => update({ kg: e.target.value })}
                    placeholder="75"
                  />
                </label>
              </div>
            )}

            <label className="field">
              <span className="field__label">
                Chest ({form.units === 'us' ? 'in' : 'cm'}){' '}
                <span className="field__optional">optional, most accurate</span>
              </span>
              <input
                inputMode="decimal"
                value={form.chest}
                onChange={(e) => update({ chest: e.target.value })}
                placeholder={form.units === 'us' ? '40' : '102'}
              />
            </label>

            <fieldset className="fit-choice">
              <legend className="field__label">How do you like it to fit?</legend>
              <div className="fit-choice__options">
                {FITS.map((fit) => (
                  <label key={fit.value} className={form.fit === fit.value ? 'is-active' : ''}>
                    <input
                      type="radio"
                      name="fit"
                      value={fit.value}
                      checked={form.fit === fit.value}
                      onChange={() => update({ fit: fit.value })}
                    />
                    <strong>{fit.label}</strong>
                    <span>{fit.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error && (
              <p className="notice notice--error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button button--block" disabled={pending}>
              {pending ? 'Measuring…' : 'Find my size'}
            </button>
            <p className="size-helper__fine">Your measurements are only used to pick a size and aren't saved.</p>
          </form>
        ) : (
          <div className="size-result" aria-live="polite">
            <div className="size-result__hero">
              <span className="size-result__badge">{advice.size}</span>
              <div>
                <p className="eyebrow">Your size</p>
                <p className="size-result__headline">
                  {advice.between_sizes && advice.alternative
                    ? `${advice.size}, or ${advice.alternative} for a different fit`
                    : `We'd go with ${advice.size}`}
                </p>
              </div>
            </div>
            <p>{advice.explanation}</p>
            {advice.fit_note && <p className="size-result__fit">Fit: {advice.fit_note}</p>}
            {main && (
              <ul className="size-result__stock">
                <li className={`is-${main.tone}`}>{main.text}</li>
                {alt && <li className={`is-${alt.tone}`}>{alt.text}</li>}
              </ul>
            )}
            <div className="button-row">
              {onChoose && (
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    onChoose(advice.size)
                    onClose()
                  }}
                >
                  {chooseLabel ? chooseLabel(advice.size) : `Choose ${advice.size}`}
                </button>
              )}
              {product && advice.in_stock && (
                <button type="button" className="button button--ghost" onClick={(e) => addToCart(advice.size, e)}>
                  Add {advice.size} to cart
                </button>
              )}
              <button type="button" className="text-button" onClick={() => setAdvice(null)}>
                Start over
              </button>
            </div>
            <details className="size-chart">
              <summary>Size chart</summary>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Size</th>
                    <th scope="col">Chest (in)</th>
                    <th scope="col">Height</th>
                    <th scope="col">Weight (lb)</th>
                  </tr>
                </thead>
                <tbody>
                  {advice.chart.map((row) => (
                    <tr key={row.size} className={row.size === advice.size ? 'is-match' : ''}>
                      <th scope="row">{row.size}</th>
                      <td>{row.chest_in}</td>
                      <td>{row.height}</td>
                      <td>{row.weight_lb}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
