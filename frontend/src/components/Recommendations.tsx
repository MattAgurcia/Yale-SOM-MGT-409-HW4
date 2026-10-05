import { useState } from 'react'
import { useRecommendations, type ProductRecommendations } from '../api'
import ProductCard from './ProductCard'

/**
 * Under a product's page: "Complete the look" (pieces that pair with it) and
 * similar styles. When the chosen size is sold out, the similar styles move to
 * the top as "these are in stock in your size".
 */
export default function Recommendations({ productId, size }: { productId: string; size: string | null }) {
  const recs = useRecommendations(productId, size)
  // Keep showing the last results while a new size loads, so the page doesn't jump.
  const [shown, setShown] = useState<ProductRecommendations | null>(null)
  if (recs.status === 'ready' && recs.data !== shown) setShown(recs.data)
  const data = recs.status === 'ready' ? recs.data : shown?.product_id === productId ? shown : null
  if (!data) return null

  const { similar, complete_the_look: look, size_sold_out: soldOut } = data
  const inSize = data.size ? ` in ${data.size}` : ''

  return (
    <>
      {soldOut && (
        <section className="recs recs--alert" aria-labelledby="recs-instead">
          <p className="eyebrow">Not in your size</p>
          <h2 id="recs-instead">
            Sold out in {data.size}. These similar styles are in stock in {data.size}.
          </h2>
          {similar.length > 0 ? (
            <div className="product-grid product-grid--four">
              {similar.map((rec) => (
                <ProductCard key={rec.product.product_id} product={rec.product} role={rec.role} reason={rec.reason} />
              ))}
            </div>
          ) : (
            <p className="recs__empty">Nothing similar is in stock in {data.size} right now.</p>
          )}
        </section>
      )}

      {look.length > 0 && (
        <section className="recs" aria-labelledby="recs-look">
          <p className="eyebrow">Complete the look</p>
          <h2 id="recs-look">Wear it with</h2>
          <p className="recs__lead">
            Pieces that layer with this one, picked for colours that go together and in stock{inSize}.
          </p>
          <div className="product-grid product-grid--four">
            {look.map((rec) => (
              <ProductCard key={rec.product.product_id} product={rec.product} role={rec.role} reason={rec.reason} />
            ))}
          </div>
        </section>
      )}

      {!soldOut && similar.length > 0 && (
        <section className="recs" aria-labelledby="recs-similar">
          <p className="eyebrow">Similar styles</p>
          <h2 id="recs-similar">If you like this one</h2>
          <div className="product-grid product-grid--four">
            {similar.map((rec) => (
              <ProductCard key={rec.product.product_id} product={rec.product} role={rec.role} reason={rec.reason} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
