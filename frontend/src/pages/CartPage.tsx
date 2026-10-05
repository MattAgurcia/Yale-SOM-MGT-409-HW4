import { useEffect } from 'react'
import { Link } from 'react-router'
import { formatPrice, usePageTitle, useProducts } from '../api'
import { useCart } from '../cart/cartContext'
import { useChat } from '../chat/chatContext'
import CartLines from '../components/CartLines'
import DanAvatar from '../components/DanAvatar'

export default function CartPage() {
  usePageTitle('Your cart')
  const cart = useCart()
  const { setOpen: openChat } = useChat()
  const products = useProducts()
  const { sync } = cart

  // Prices and stock may have changed since things went in the cart: re-check against the shop.
  useEffect(() => {
    if (products.status === 'ready') sync(products.data)
  }, [products, sync])

  const soldOut = cart.items.filter((item) => item.inStock === 0)

  return (
    <section className="section container cart-page">
      <header className="page-head reveal">
        <p className="eyebrow">Your cart</p>
        <h1>
          {cart.count > 0
            ? `${cart.count} ${cart.count === 1 ? 'piece' : 'pieces'} of Bulldog blue.`
            : 'Nothing here yet.'}
        </h1>
      </header>

      {cart.items.length === 0 ? (
        <div className="glass empty-state reveal">
          <DanAvatar size={110} />
          <div>
            <h2>Your cart is empty.</h2>
            <p>Every card in the shop has an Add to cart button. Or ask Dan to sniff out something for you.</p>
            <div className="button-row">
              <Link to="/products" className="button">
                Shop the lineup
              </Link>
              <button type="button" className="button button--ghost" onClick={() => openChat(true)}>
                Ask Dan
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="cart-layout">
          <div className="glass cart-page__lines reveal">
            <CartLines />
            <button type="button" className="text-button" onClick={cart.clear}>
              Empty cart
            </button>
          </div>

          <aside className="glass cart-summary reveal" aria-labelledby="summary-title">
            <h2 id="summary-title">Summary</h2>
            <dl>
              <div>
                <dt>Items</dt>
                <dd>{cart.count}</dd>
              </div>
              <div className="cart-summary__total">
                <dt>Subtotal</dt>
                <dd>{formatPrice(cart.subtotal)}</dd>
              </div>
            </dl>
            {soldOut.length > 0 && (
              <p className="notice notice--error">
                {soldOut.map((item) => `${item.name} (${item.size})`).join(', ')}{' '}
                {soldOut.length === 1 ? 'has' : 'have'} sold out since you added {soldOut.length === 1 ? 'it' : 'them'}.
              </p>
            )}
            <button type="button" className="button button--block" disabled>
              Checkout coming soon
            </button>
            <p className="cart-summary__fine">
              We're not taking online orders yet. Bring your list to the shop at 57 Broadway, New Haven, and we'll pull
              your sizes. Your cart is saved on this device.
            </p>
          </aside>
        </div>
      )}
    </section>
  )
}
