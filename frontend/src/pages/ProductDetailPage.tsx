import { useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router'
import { LOW_STOCK, formatPrice, useCategories, usePageTitle, useProduct, type Product, type SizeStock } from '../api'
import { stockIn, useCart } from '../cart/cartContext'
import { flyToCart } from '../cart/flyToCart'
import { useChat } from '../chat/chatContext'
import { BagIcon, MinusIcon, PlusIcon, RulerIcon } from '../components/Icons'
import Recommendations from '../components/Recommendations'
import SizeHelper from '../components/SizeHelper'
import NotFoundPage from './NotFoundPage'

function stockLabel({ quantity }: SizeStock) {
  if (quantity === 0) return { text: 'Sold out', tone: 'out' }
  if (quantity <= LOW_STOCK) return { text: `Only ${quantity} left`, tone: 'low' }
  return { text: `${quantity} in stock`, tone: 'in' }
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Size picked, quantity and Add to cart. */
function Purchase({ product, size, onFindSize }: { product: Product; size: string | null; onFindSize: () => void }) {
  const cart = useCart()
  const [quantity, setQuantity] = useState(1)
  const available = size ? stockIn(product, size) : 0
  const inCart = size
    ? (cart.items.find((i) => i.productId === product.product_id && i.size === size)?.quantity ?? 0)
    : 0
  const room = Math.max(0, Math.min(available, 10) - inCart)
  const amount = Math.max(1, Math.min(quantity, room || 1))

  function add(event: MouseEvent<HTMLButtonElement>) {
    if (!size) return
    if (cart.add(product, size, amount) > 0) flyToCart(event.currentTarget)
    setQuantity(1)
  }

  let label = 'Choose a size'
  if (product.total_stock === 0) label = 'Sold out'
  else if (size && available === 0) label = `Sold out in ${size}`
  else if (size && room === 0) label = `All ${available} in ${size} are in your cart`
  else if (size)
    label = `Add ${amount > 1 ? `${amount} × ` : ''}${size} to cart · ${formatPrice(product.price * amount)}`

  return (
    <div className="purchase">
      <div className="purchase__row">
        <div className="stepper stepper--large" role="group" aria-label="Quantity">
          <button type="button" aria-label="One fewer" disabled={amount <= 1} onClick={() => setQuantity(amount - 1)}>
            <MinusIcon size={16} />
          </button>
          <output aria-live="polite">{amount}</output>
          <button
            type="button"
            aria-label="One more"
            disabled={!size || amount >= room}
            onClick={() => setQuantity(amount + 1)}
          >
            <PlusIcon size={16} />
          </button>
        </div>
        <button type="button" className="button button--cart" disabled={!size || room === 0} onClick={add}>
          <BagIcon size={18} />
          {label}
        </button>
      </div>
      <button type="button" className="text-button purchase__size-help" onClick={onFindSize}>
        <RulerIcon size={16} /> Not sure of your size? Find my size
      </button>
    </div>
  )
}

export default function ProductDetailPage() {
  const { productId = '' } = useParams()
  const product = useProduct(productId)
  const categories = useCategories()
  const { setOpen: openChat } = useChat()
  usePageTitle(product.status === 'ready' ? product.data.name : undefined)
  // The size the shopper picked, for this product only.
  const [picked, setPicked] = useState<{ productId: string; size: string } | null>(null)
  const [sizeHelp, setSizeHelp] = useState(false)
  const size = picked?.productId === productId ? picked.size : null
  const choose = (next: string) => setPicked(size === next ? null : { productId, size: next })

  if (product.status === 'error' && product.notFound) return <NotFoundPage />

  const data = product.status === 'ready' ? product.data : null
  const cats = categories.status === 'ready' ? categories.data : null
  const type = data && cats?.types.find((t) => t.slug === data.category)
  const collection = data && cats?.collections.find((c) => data.collections.includes(c.slug))

  return (
    <section className="container detail-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/products">Shop</Link>
        {type && (
          <>
            <span aria-hidden="true">/</span>
            <Link to={`/products?type=${type.slug}`}>{type.name}</Link>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span aria-current="page">{data ? data.name : '…'}</span>
      </nav>

      {product.status === 'loading' && (
        <div className="detail" aria-hidden="true">
          <span className="skeleton skeleton--hero" />
          <div className="detail__info glass">
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line skeleton--short" />
          </div>
        </div>
      )}
      {product.status === 'error' && (
        <p className="notice">We couldn't load this product right now. Please refresh to try again.</p>
      )}

      {data && (
        <div className="detail" data-cart-source>
          <div className="detail__media glass">
            <img src={data.image_url} alt={data.name} />
            {data.total_stock === 0 && <span className="badge badge--out">Sold out</span>}
          </div>

          <div className="detail__info glass">
            <div className="detail__tags-row">
              <span className="eyebrow">{data.garment_type}</span>
              {collection && (
                <Link to={`/products?collection=${collection.slug}`} className="pill pill--small">
                  {collection.name}
                </Link>
              )}
              {data.affiliations.slice(0, 2).map((aff) => (
                <Link
                  key={aff}
                  to={`/products?collection=${collection?.slug ?? ''}&aff=${encodeURIComponent(aff)}`}
                  className="pill pill--small"
                >
                  {aff}
                </Link>
              ))}
            </div>
            <h1 className="detail__name">{data.name}</h1>
            <p className="detail__price">{formatPrice(data.price)}</p>
            <p className="detail__description">{data.description}</p>

            <div className="detail__block">
              <div className="detail__block-head">
                <h2 className="eyebrow">Size</h2>
                <p className="detail__total">
                  {data.total_stock > 0 ? `${data.total_stock} in stock across all sizes` : 'Sold out in every size'}
                </p>
              </div>
              <ul className="size-grid">
                {data.inventory.map((row) => {
                  const label = stockLabel(row)
                  const selected = size === row.size
                  return (
                    <li key={row.size}>
                      <button
                        type="button"
                        className={`size-cell is-${label.tone}${selected ? ' is-selected' : ''}`}
                        aria-pressed={selected}
                        onClick={() => choose(row.size)}
                      >
                        <span className="size-cell__size">{row.size}</span>
                        <span className="size-cell__status">{label.text}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="detail__hint">
                {size
                  ? `Size ${size} picked: pairings below are in stock in ${size}. Tap ${size} again to clear.`
                  : 'Pick your size to add it to your cart and see pairings in stock in that size.'}
              </p>
            </div>

            <Purchase product={data} size={size} onFindSize={() => setSizeHelp(true)} />

            <div className="detail__block">
              <h2 className="eyebrow">Color</h2>
              <p>
                {data.colors.length > 0
                  ? data.colors.map(sentenceCase).join(', ')
                  : "Colors aren't listed for this piece. See the photo for details."}
              </p>
            </div>

            <button type="button" className="detail__ask" onClick={() => openChat(true)}>
              Questions about this piece? <strong>Ask Dan</strong>, our bulldog. He knows what's on the shelf.
            </button>
          </div>
        </div>
      )}

      {data && <Recommendations productId={productId} size={size} />}

      <SizeHelper
        open={sizeHelp}
        onClose={() => setSizeHelp(false)}
        product={data}
        onChoose={(next) => setPicked({ productId, size: next })}
        chooseLabel={(next) => `Choose ${next}`}
      />
    </section>
  )
}
