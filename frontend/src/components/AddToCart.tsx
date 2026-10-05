import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { Product } from '../api'
import { useCart } from '../cart/cartContext'
import { flyToCart } from '../cart/flyToCart'
import { BagIcon, CheckIcon, PlusIcon } from './Icons'

interface Props {
  product: Product
  /** "card": over a product card's photo. "compact": a small button on the chat's cards. */
  variant?: 'card' | 'compact'
}

/**
 * "Add to cart" for any product card: opens a row of sizes (sold-out sizes
 * crossed out), and picking one drops it in the cart with a fly-to-cart
 * flourish. Product pages use their own size grid and button instead.
 */
export default function AddToCart({ product, variant = 'card' }: Props) {
  const cart = useCart()
  const [choosing, setChoosing] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const timer = useRef(0)
  const soldOut = product.total_stock === 0

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // While the sizes are open: Escape or a click elsewhere closes them, and focus starts on the first size.
  useEffect(() => {
    if (!choosing) return
    rootRef.current?.querySelector<HTMLButtonElement>('.size-chip:not(:disabled)')?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setChoosing(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChoosing(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [choosing])

  function pick(size: string, event: MouseEvent<HTMLButtonElement>) {
    if (cart.add(product, size) > 0) flyToCart(event.currentTarget)
    setChoosing(false)
    setAdded(size)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setAdded(null), 1800)
  }

  const label = soldOut ? 'Sold out' : added ? `Added ${added}` : variant === 'compact' ? 'Add' : 'Add to cart'

  return (
    <div
      ref={rootRef}
      className={`add-to-cart add-to-cart--${variant}${choosing ? ' is-choosing' : ''}${added ? ' is-added' : ''}`}
    >
      {choosing && (
        <div className="add-to-cart__sizes" role="group" aria-label={`Choose a size of ${product.name}`}>
          <span className="add-to-cart__prompt">Pick a size</span>
          <ul>
            {product.inventory.map((row, index) => (
              <li key={row.size} style={{ animationDelay: `${index * 30}ms` }}>
                <button
                  type="button"
                  className="size-chip"
                  disabled={row.quantity === 0}
                  title={row.quantity === 0 ? `${row.size} is sold out` : `Add ${row.size}`}
                  onClick={(event) => pick(row.size, event)}
                >
                  {row.size}
                  {row.quantity === 0 && <span className="visually-hidden"> (sold out)</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="add-to-cart__button"
        disabled={soldOut}
        aria-expanded={soldOut ? undefined : choosing}
        aria-label={soldOut ? `${product.name} is sold out` : `Add ${product.name} to cart`}
        onClick={() => setChoosing((open) => !open)}
      >
        {added ? <CheckIcon size={16} /> : variant === 'compact' ? <PlusIcon size={15} /> : <BagIcon size={16} />}
        <span>{label}</span>
      </button>
    </div>
  )
}
