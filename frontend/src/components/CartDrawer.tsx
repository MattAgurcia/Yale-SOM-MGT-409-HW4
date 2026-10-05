import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { formatPrice } from '../api'
import { useCart } from '../cart/cartContext'
import CartLines from './CartLines'
import DanAvatar from './DanAvatar'
import { CloseIcon } from './Icons'

/** The cart, sliding in from the right over whatever page is open. */
export default function CartDrawer() {
  const cart = useCart()
  const { drawerOpen: open, setDrawerOpen } = cart
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    document.body.classList.add('has-overlay')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.classList.remove('has-overlay')
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus?.()
    }
  }, [open, setDrawerOpen])

  if (!open) return null
  const close = () => setDrawerOpen(false)

  return createPortal(
    <div className="drawer-layer">
      <button type="button" className="drawer-scrim" aria-label="Close cart" tabIndex={-1} onClick={close} />
      <aside
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        tabIndex={-1}
      >
        <header className="drawer__head">
          <h2 id="cart-title">
            Your cart <span className="drawer__count">{cart.count}</span>
          </h2>
          <button type="button" className="icon-button" aria-label="Close cart" onClick={close}>
            <CloseIcon />
          </button>
        </header>

        {cart.items.length === 0 ? (
          <div className="drawer__empty">
            <DanAvatar size={88} />
            <p>Your cart's empty. Let's fetch something blue!</p>
            <Link to="/products" className="button" onClick={close}>
              Start shopping
            </Link>
          </div>
        ) : (
          <>
            <div className="drawer__body">
              <CartLines onNavigate={close} />
            </div>
            <footer className="drawer__foot">
              <p className="drawer__subtotal">
                <span>Subtotal</span>
                <strong>{formatPrice(cart.subtotal)}</strong>
              </p>
              <p className="drawer__fine">Online checkout is coming soon. Your cart is saved on this device.</p>
              <Link to="/cart" className="button button--block" onClick={close}>
                View cart
              </Link>
            </footer>
          </>
        )}
      </aside>
    </div>,
    document.body,
  )
}
