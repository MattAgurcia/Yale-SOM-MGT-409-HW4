import { useEffect } from 'react'
import { useCart } from '../cart/cartContext'
import { CheckIcon, CloseIcon } from './Icons'

const SHOW_FOR_MS = 3600

/** "Added to your cart" under the header after each add, with a shortcut to the cart. */
export default function CartToast() {
  const { notice, dismissNotice, setDrawerOpen } = useCart()

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(dismissNotice, SHOW_FOR_MS)
    return () => window.clearTimeout(timer)
    // A new notice (new id) restarts the timer.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?.id])

  if (!notice) return null
  const { item, warning } = notice

  return (
    <div key={notice.id} className={`cart-toast${warning ? ' cart-toast--warn' : ''}`} role="status">
      <img src={item.imageUrl} alt="" />
      <div className="cart-toast__text">
        <p className="cart-toast__title">
          {!warning && <CheckIcon size={16} />}
          {warning ?? 'Added to your cart'}
        </p>
        <p className="cart-toast__item">
          {item.name} · {item.size}
        </p>
      </div>
      <button
        type="button"
        className="cart-toast__view"
        onClick={() => {
          dismissNotice()
          setDrawerOpen(true)
        }}
      >
        View cart
      </button>
      <button type="button" className="cart-toast__close" aria-label="Dismiss" onClick={dismissNotice}>
        <CloseIcon size={14} />
      </button>
      <span className="cart-toast__timer" aria-hidden="true" />
    </div>
  )
}
