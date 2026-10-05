import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { formatPrice, useCategories, usePageTitle, useProducts, type Product } from '../api'
import { useChat } from '../chat/chatContext'
import DanAvatar from '../components/DanAvatar'
import { ArrowRightIcon } from '../components/Icons'
import ProductCard from '../components/ProductCard'

const HERO_PRODUCT_ID = 'basic-hoodie-big-yale'
const FLOAT_IDS = ['morse-1-4-zip', 'yale-mom-crewneck']
const STAFF_PICK_IDS = ['champion-reverse-weave-hoodie-1', 'yale-mom-crewneck', 'boola-boola-t-shirt', 'morse-1-4-zip']

const MARQUEE = [
  'Boola boola',
  'Est. 1701',
  '57 Broadway',
  'Bulldog blue',
  'New Haven, CT',
  'Officially licensed',
  'For God, for Country & for Yale',
]

export default function HomePage() {
  usePageTitle()
  const products = useProducts()
  const categories = useCategories()
  const { setOpen: openChat } = useChat()
  const all: Product[] = products.status === 'ready' ? products.data : []
  const byId = (id: string) => all.find((p) => p.product_id === id)
  const hero = byId(HERO_PRODUCT_ID)
  const floaters = FLOAT_IDS.map(byId).filter((p): p is Product => !!p)
  const picks = STAFF_PICK_IDS.map(byId).filter((p): p is Product => !!p)
  const collections =
    categories.status === 'ready' ? categories.data.collections.filter((c) => c.slug !== 'classics') : []
  const types = categories.status === 'ready' ? categories.data.types : []

  return (
    <>
      <section className="container bento">
        <div className="bento__hero glass glass--dark">
          <span className="orb orb--1" aria-hidden="true" />
          <span className="orb orb--2" aria-hidden="true" />
          <div className="bento__hero-copy">
            <p className="eyebrow eyebrow--light">Yale apparel · 57 Broadway, New Haven</p>
            <h1 className="display">
              Bulldog blue,
              <br />
              <span className="display__accent">all the way through.</span>
            </h1>
            <p className="hero__lead">
              Crewnecks, hoodies, quarter-zips and tees for students, alumni and every proud parent in the stands, all
              stocked at our shop a short walk from campus.
            </p>
            <div className="button-row">
              <Link to="/products" className="button button--light">
                Shop the lineup <ArrowRightIcon size={18} />
              </Link>
              <Link to="/categories" className="button button--glass">
                Browse categories
              </Link>
            </div>
          </div>
          {hero && (
            <div className="bento__hero-stage" data-cart-source>
              <Link
                to={`/products/${hero.product_id}`}
                className="hero-product"
                aria-label={`${hero.name}, ${formatPrice(hero.price)}`}
              >
                <img src={hero.image_url} alt="" />
                <span className="hero-product__tag glass">
                  <span>{hero.name}</span>
                  <strong>{formatPrice(hero.price)}</strong>
                </span>
              </Link>
              {floaters.map((p, i) => (
                <Link
                  key={p.product_id}
                  to={`/products/${p.product_id}`}
                  className={`floater floater--${i + 1}`}
                  tabIndex={-1}
                  aria-hidden="true"
                >
                  <img src={p.image_url} alt="" />
                </Link>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="bento__dan glass" onClick={() => openChat(true)}>
          <DanAvatar size={92} mood="happy" />
          <span>
            <span className="eyebrow">Meet Dan</span>
            <strong>Our bulldog helper</strong>
            <span>Ask about sizes, stock or what goes with what. Woof!</span>
          </span>
        </button>

        <Link to="/products?sort=stock" className="bento__stat glass">
          <strong className="bento__number">{all.length || '100+'}</strong>
          <span>pieces on the shelf, with live stock by size</span>
          <ArrowRightIcon size={18} />
        </Link>
      </section>

      <div className="marquee" aria-hidden="true">
        <div className="marquee__track">
          {[...MARQUEE, ...MARQUEE].map((word, i) => (
            <span key={i}>
              {word} <span className="marquee__dot">✦</span>
            </span>
          ))}
        </div>
      </div>

      <section className="section container">
        <div className="section-head reveal">
          <div>
            <p className="eyebrow">Shop by type</p>
            <h2>Pick your layer.</h2>
          </div>
          <Link to="/categories" className="text-link">
            All categories <ArrowRightIcon size={16} />
          </Link>
        </div>
        <ul className="type-rail">
          {types.map((type, index) => (
            <li key={type.slug} className="reveal" style={{ '--i': index } as CSSProperties}>
              <Link to={`/products?type=${type.slug}`} className="type-chip glass">
                {type.cover_image && <img src={type.cover_image} alt="" loading="lazy" />}
                <span>
                  <strong>{type.name}</strong>
                  <span>{type.count} pieces</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="section container">
        <div className="section-head reveal">
          <div>
            <p className="eyebrow">Staff picks</p>
            <h2>Layer up like a local.</h2>
          </div>
          <div className="section-head__aside">
            <p>
              Heavyweight hoodies, soft crews and easy tees: the pieces we reach for from first-day jitters to
              Commencement weekend.
            </p>
            <Link to="/products" className="text-link">
              See all {all.length || ''} pieces <ArrowRightIcon size={16} />
            </Link>
          </div>
        </div>

        {products.status === 'error' && (
          <p className="notice">We couldn't load the lineup right now. Please refresh to try again.</p>
        )}
        {picks.length > 0 && (
          <div className="product-grid product-grid--four">
            {picks.map((product, index) => (
              <ProductCard key={product.product_id} product={product} index={index} />
            ))}
          </div>
        )}
      </section>

      <section className="section container">
        <div className="section-head reveal">
          <div>
            <p className="eyebrow">Collections</p>
            <h2>Something for every Bulldog.</h2>
          </div>
        </div>
        <ol className="collection-tiles">
          {collections.map((collection, index) => (
            <li key={collection.slug} className="reveal" style={{ '--i': index } as CSSProperties}>
              <Link to={`/products?collection=${collection.slug}`} className="collection-tile glass">
                <span className="collection-tile__num">{String(index + 1).padStart(2, '0')}</span>
                {collection.cover_image && <img src={collection.cover_image} alt="" loading="lazy" />}
                <span className="collection-tile__name">{collection.name}</span>
                <span className="collection-tile__blurb">{collection.blurb}</span>
                <span className="collection-tile__cta">
                  {collection.count} pieces <ArrowRightIcon size={16} />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="section container">
        <div className="visit glass glass--dark reveal">
          <span className="orb orb--3" aria-hidden="true" />
          <div>
            <p className="eyebrow eyebrow--light">Visit</p>
            <h2>Come try it on.</h2>
          </div>
          <div>
            <address className="visit__address">
              57 Broadway
              <br />
              New Haven, CT 06511
            </address>
            <p>Find your size, feel the fleece, and pick up something blue on your way to class.</p>
            <Link to="/about" className="text-link text-link--light">
              More about us <ArrowRightIcon size={16} />
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
