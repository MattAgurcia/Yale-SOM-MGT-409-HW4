import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { useCategories, usePageTitle } from '../api'
import { ArrowRightIcon } from '../components/Icons'
import { SWATCHES } from '../shop/filters'

export default function CategoriesPage() {
  usePageTitle('Categories')
  const categories = useCategories()

  return (
    <section className="section container categories-page">
      <header className="page-head reveal">
        <p className="eyebrow">Categories</p>
        <h1>Find your corner of Yale.</h1>
        <p className="lead">
          Shop by what you want to wear, or by who you're cheering for: your residential college, your team, your
          school, or the Bulldog in your family.
        </p>
      </header>

      {categories.status === 'loading' && (
        <div className="tile-grid" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="skeleton skeleton--tile" />
          ))}
        </div>
      )}
      {categories.status === 'error' && (
        <p className="notice">We couldn't load the categories. Please refresh to try again.</p>
      )}

      {categories.status === 'ready' && (
        <>
          <section className="cat-section" aria-labelledby="types-title">
            <div className="section-head reveal">
              <div>
                <p className="eyebrow">Shop by type</p>
                <h2 id="types-title">What are you wearing?</h2>
              </div>
              <p className="section-head__aside">Every piece is unisex, sized XS to XXL.</p>
            </div>
            <ul className="tile-grid tile-grid--types">
              {categories.data.types.map((type, index) => (
                <li key={type.slug} className="reveal" style={{ '--i': index } as CSSProperties}>
                  <Link to={`/products?type=${type.slug}`} className="tile">
                    {type.cover_image && <img className="tile__image" src={type.cover_image} alt="" loading="lazy" />}
                    <span className="tile__count">{type.count} pieces</span>
                    <span className="tile__body">
                      <span className="tile__name">{type.name}</span>
                      <span className="tile__blurb">{type.blurb}</span>
                      <span className="tile__cta">
                        Shop {type.name.toLowerCase()} <ArrowRightIcon size={16} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="cat-section" aria-labelledby="collections-title">
            <div className="section-head reveal">
              <div>
                <p className="eyebrow">Collections</p>
                <h2 id="collections-title">Who are you cheering for?</h2>
              </div>
            </div>
            <ul className="collection-list">
              {categories.data.collections.map((collection, index) => (
                <li key={collection.slug} className="collection glass reveal" style={{ '--i': index } as CSSProperties}>
                  <Link to={`/products?collection=${collection.slug}`} className="collection__media" tabIndex={-1}>
                    {collection.cover_image && <img src={collection.cover_image} alt="" loading="lazy" />}
                  </Link>
                  <div className="collection__body">
                    <p className="eyebrow">{collection.count} pieces</p>
                    <h3>
                      <Link to={`/products?collection=${collection.slug}`}>{collection.name}</Link>
                    </h3>
                    <p>{collection.blurb}</p>
                    {collection.affiliations.length > 0 && (
                      <ul className="pill-list pill-list--small" aria-label={`${collection.name} to shop`}>
                        {collection.affiliations.map((aff) => (
                          <li key={aff.label}>
                            <Link
                              className="pill pill--small"
                              to={`/products?collection=${collection.slug}&aff=${encodeURIComponent(aff.label)}`}
                            >
                              {aff.label}
                              <span className="pill__count">{aff.count}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link to={`/products?collection=${collection.slug}`} className="text-link">
                      Shop all {collection.name.toLowerCase()} <ArrowRightIcon size={16} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="cat-section" aria-labelledby="colours-title">
            <div className="section-head reveal">
              <div>
                <p className="eyebrow">Shop by colour</p>
                <h2 id="colours-title">Blue, of course. And friends.</h2>
              </div>
            </div>
            <ul className="colour-row reveal">
              {categories.data.colours.map((colour) => (
                <li key={colour.slug}>
                  <Link to={`/products?color=${colour.slug}`} className="colour-chip glass">
                    <span className="colour-chip__dot" style={{ background: SWATCHES[colour.slug] }} />
                    <span>
                      <strong>{colour.name}</strong>
                      <span>{colour.count} pieces</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  )
}
