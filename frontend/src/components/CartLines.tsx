import { Link } from 'react-router'
import { LOW_STOCK, formatPrice } from '../api'
import { useCart, type CartItem } from '../cart/cartContext'
import { MinusIcon, PlusIcon, TrashIcon } from './Icons'

function stockNote(item: CartItem): { text: string; tone: string } | null {
  if (item.inStock === 0) return { text: `Sold out in ${item.size} now`, tone: 'out' }
  if (item.quantity >= item.inStock) return { text: `That's all ${item.inStock} we have in ${item.size}`, tone: 'low' }
  if (item.inStock <= LOW_STOCK) return { text: `Only ${item.inStock} left in ${item.size}`, tone: 'low' }
  return null
}

/** The cart's lines with quantity steppers, shared by the drawer and the cart page. */
export default function CartLines({ onNavigate }: { onNavigate?: () => void }) {
  const { items, setQuantity, remove } = useCart()

  return (
    <ul className="cart-lines">
      {items.map((item) => {
        const note = stockNote(item)
        return (
          <li key={`${item.productId}:${item.size}`} className={`cart-line${item.inStock === 0 ? ' is-out' : ''}`}>
            <Link to={`/products/${item.productId}`} className="cart-line__image" onClick={onNavigate} tabIndex={-1}>
              <img src={item.imageUrl} alt="" />
            </Link>
            <div className="cart-line__info">
              <Link to={`/products/${item.productId}`} className="cart-line__name" onClick={onNavigate}>
                {item.name}
              </Link>
              <p className="cart-line__meta">
                Size {item.size} · {formatPrice(item.price)}
              </p>
              {note && <p className={`cart-line__note is-${note.tone}`}>{note.text}</p>}
              <div className="cart-line__controls">
                <div className="stepper" role="group" aria-label={`Quantity of ${item.name}, size ${item.size}`}>
                  <button
                    type="button"
                    aria-label="One fewer"
                    onClick={() => setQuantity(item.productId, item.size, item.quantity - 1)}
                  >
                    <MinusIcon size={14} />
                  </button>
                  <output aria-live="polite">{item.quantity}</output>
                  <button
                    type="button"
                    aria-label="One more"
                    disabled={item.quantity >= Math.min(item.inStock, 10)}
                    onClick={() => setQuantity(item.productId, item.size, item.quantity + 1)}
                  >
                    <PlusIcon size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  className="cart-line__remove"
                  aria-label={`Remove ${item.name}, size ${item.size}`}
                  onClick={() => remove(item.productId, item.size)}
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>
            <p className="cart-line__total">{formatPrice(item.price * item.quantity)}</p>
          </li>
        )
      })}
    </ul>
  )
}
