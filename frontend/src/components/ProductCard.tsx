import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { formatPrice, type Product } from '../api'
import AddToCart from './AddToCart'

/** Units across all sizes at or below which a card says "Almost gone". */
const ALMOST_GONE = 8

function stockLine(product: Product): string {
  const inStock = product.inventory.filter((row) => row.quantity > 0).map((row) => row.size)
  if (inStock.length === 0) return 'Sold out'
  if (inStock.length === product.inventory.length) return 'In stock in every size'
  return `In stock: ${inStock.join(', ')}`
}

function badge(product: Product): { text: string; tone: string } | null {
  if (product.total_stock === 0) return { text: 'Sold out', tone: 'out' }
  if (product.total_stock <= ALMOST_GONE) return { text: 'Almost gone', tone: 'low' }
  return null
}

interface Props {
  product: Product
  /** Add a short description and which sizes are in stock (chat results). */
  showInfo?: boolean
  /** For a recommendation: how it relates ("Wear under") and why. */
  role?: string
  reason?: string
  /** Position in its grid, to stagger the entrance animation. */
  index?: number
}

/**
 * One product: photo, name and price, opening its page, with Add to cart over
 * the photo. The whole card is clickable through the name's link (stretched
 * over the card), so the cart button isn't nested inside a link.
 */
export default function ProductCard({ product, showInfo = false, role, reason, index = 0 }: Props) {
  const tag = badge(product)
  const affiliation = product.affiliations[0]

  return (
    <article
      className={`product-card${product.total_stock === 0 ? ' is-sold-out' : ''}`}
      data-cart-source
      style={{ '--i': Math.min(index, 12) } as CSSProperties}
    >
      {role && <p className="product-card__role">{role}</p>}
      <div className="product-card__media">
        <img src={product.image_url} alt="" loading="lazy" />
        {tag && <span className={`badge badge--${tag.tone}`}>{tag.text}</span>}
        <AddToCart product={product} />
      </div>
      <div className="product-card__body">
        <p className="product-card__type">
          {product.garment_type}
          {affiliation && <span className="product-card__aff">{affiliation}</span>}
        </p>
        <h3 className="product-card__name">
          <Link to={`/products/${product.product_id}`} className="product-card__link">
            {product.name}
          </Link>
        </h3>
        {reason && <p className="product-card__reason">{reason}</p>}
        {showInfo && <p className="product-card__info">{product.description}</p>}
        <div className="product-card__foot">
          <p className="product-card__price">{formatPrice(product.price)}</p>
          {(showInfo || role) && <p className="product-card__stock">{stockLine(product)}</p>}
        </div>
      </div>
    </article>
  )
}
