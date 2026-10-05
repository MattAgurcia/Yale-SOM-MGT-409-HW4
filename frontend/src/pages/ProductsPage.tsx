import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { formatPrice, useCategories, usePageTitle, useProducts, type Product, type ShopCategories } from '../api'
import { useChat } from '../chat/chatContext'
import DanAvatar from '../components/DanAvatar'
import { CloseIcon, FilterIcon, RulerIcon, SearchIcon } from '../components/Icons'
import ProductCard from '../components/ProductCard'
import SizeHelper from '../components/SizeHelper'
import {
  EMPTY_FILTERS,
  SIZES,
  SORTS,
  SWATCHES,
  activeCount,
  applyFilters,
  countBy,
  readFilters,
  sortProducts,
  writeFilters,
  type Filters,
  type SortKey,
} from '../shop/filters'

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

function SkeletonGrid() {
  return (
    <div className="product-grid" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="skeleton-card">
          <span className="skeleton skeleton--media" />
          <span className="skeleton skeleton--line" />
          <span className="skeleton skeleton--line skeleton--short" />
        </div>
      ))}
    </div>
  )
}

interface PanelProps {
  products: Product[]
  cats: ShopCategories
  filters: Filters
  set: (patch: Partial<Filters>, replace?: boolean) => void
  onFindSize: () => void
}

/** The filter panel: type, collection (+ its colleges / sports / schools), colour, size in stock, price, availability. */
function FilterPanel({ products, cats, filters: f, set, onFindSize }: PanelProps) {
  const typeCounts = countBy(applyFilters(products, f, 'types'), (p) => (p.category ? [p.category] : []))
  const collectionCounts = countBy(applyFilters(products, f, 'collection', 'aff'), (p) => p.collections)
  const affCounts = countBy(applyFilters(products, f, 'aff'), (p) => p.affiliations)
  const colourCounts = countBy(applyFilters(products, f, 'colours'), (p) => (p.color_family ? [p.color_family] : []))
  const sizeCounts = countBy(applyFilters(products, f, 'size'), (p) =>
    p.inventory.filter((row) => row.quantity > 0).map((row) => row.size),
  )
  const collection = cats.collections.find((c) => c.slug === f.collection)

  const prices = products.map((p) => p.price)
  const floor = Math.floor(Math.min(...prices))
  const ceiling = Math.ceil(Math.max(...prices))
  // The slider moves on its own state and the URL follows. `seen` is the URL's value when the
  // slider last moved; if the URL changes some other way ("Clear all"), the slider follows it.
  const [price, setPrice] = useState({ seen: f.maxPrice, value: f.maxPrice ?? ceiling })
  if (price.seen !== f.maxPrice) setPrice({ seen: f.maxPrice, value: f.maxPrice ?? ceiling })

  return (
    <div className="filters__sections">
      <fieldset className="filter">
        <legend>Shop by type</legend>
        <div className="pill-list">
          {cats.types.map((type) => (
            <button
              key={type.slug}
              type="button"
              className="pill"
              aria-pressed={f.types.includes(type.slug)}
              disabled={!typeCounts.get(type.slug) && !f.types.includes(type.slug)}
              onClick={() => set({ types: toggle(f.types, type.slug) })}
            >
              {type.name}
              <span className="pill__count">{typeCounts.get(type.slug) ?? 0}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="filter">
        <legend>Collections</legend>
        <div className="pill-list">
          {cats.collections.map((c) => (
            <button
              key={c.slug}
              type="button"
              className="pill"
              aria-pressed={f.collection === c.slug}
              disabled={!collectionCounts.get(c.slug) && f.collection !== c.slug}
              onClick={() => set({ collection: f.collection === c.slug ? null : c.slug, aff: null })}
            >
              {c.name}
              <span className="pill__count">{collectionCounts.get(c.slug) ?? 0}</span>
            </button>
          ))}
        </div>
        {collection && collection.affiliations.length > 0 && (
          <div className="filter__sub">
            <p className="filter__sub-label">{collection.name}</p>
            <div className="pill-list pill-list--small">
              {collection.affiliations.map(({ label }) => (
                <button
                  key={label}
                  type="button"
                  className="pill pill--small"
                  aria-pressed={f.aff === label}
                  disabled={!affCounts.get(label)}
                  onClick={() => set({ aff: f.aff === label ? null : label })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="filter">
        <legend>Colour</legend>
        <div className="swatches">
          {cats.colours.map((colour) => (
            <button
              key={colour.slug}
              type="button"
              className="swatch"
              aria-pressed={f.colours.includes(colour.slug)}
              title={`${colour.name} (${colourCounts.get(colour.slug) ?? 0})`}
              onClick={() => set({ colours: toggle(f.colours, colour.slug) })}
            >
              <span className="swatch__dot" style={{ background: SWATCHES[colour.slug] ?? '#ccc' }} />
              <span className="swatch__name">{colour.name}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="filter">
        <legend>In stock in size</legend>
        <div className="size-pills">
          {SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className="size-chip"
              aria-pressed={f.size === size}
              disabled={!sizeCounts.get(size) && f.size !== size}
              onClick={() => set({ size: f.size === size ? null : size })}
            >
              {size}
            </button>
          ))}
        </div>
        <button type="button" className="text-button filter__size-help" onClick={onFindSize}>
          <RulerIcon size={16} /> Not sure? Find my size
        </button>
      </fieldset>

      <fieldset className="filter">
        <legend>
          Price <span className="filter__value">up to {formatPrice(price.value)}</span>
        </legend>
        <input
          type="range"
          className="range"
          min={floor}
          max={ceiling}
          step={1}
          value={price.value}
          aria-label="Maximum price"
          onChange={(event) => {
            const value = Number(event.target.value)
            setPrice({ seen: f.maxPrice, value })
            set({ maxPrice: value >= ceiling ? null : value }, true)
          }}
        />
        <div className="range__ends">
          <span>{formatPrice(floor)}</span>
          <span>{formatPrice(ceiling)}</span>
        </div>
      </fieldset>

      <label className="switch">
        <input type="checkbox" checked={f.inStock} onChange={(event) => set({ inStock: event.target.checked })} />
        <span className="switch__track" aria-hidden="true" />
        Hide sold-out pieces
      </label>
    </div>
  )
}

export default function ProductsPage() {
  const products = useProducts()
  const categories = useCategories()
  const { setOpen: openChat } = useChat()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readFilters(params), [params])
  const [panelOpen, setPanelOpen] = useState(false)
  const [sizeHelp, setSizeHelp] = useState(false)

  // The search box keeps its own text while typing and the URL follows; if the URL changes
  // some other way ("Clear all", a chip, Back), the box follows it.
  const [query, setQuery] = useState({ seen: filters.q, text: filters.q })
  if (query.seen !== filters.q) setQuery({ seen: filters.q, text: filters.q })

  const set = (patch: Partial<Filters>, replace = false) =>
    setParams(writeFilters({ ...filters, ...patch }), { replace, preventScrollReset: true })

  const ready = products.status === 'ready' && categories.status === 'ready'
  const all = useMemo(() => (products.status === 'ready' ? products.data : []), [products])
  const shown = useMemo(() => sortProducts(applyFilters(all, filters), filters.sort), [all, filters])

  const cats = categories.status === 'ready' ? categories.data : null
  const type = filters.types.length === 1 ? cats?.types.find((t) => t.slug === filters.types[0]) : undefined
  const collection = cats?.collections.find((c) => c.slug === filters.collection)
  const title = filters.aff
    ? `${filters.aff}`
    : (collection?.name ?? type?.name ?? (filters.q ? `“${filters.q}”` : 'The full lineup'))
  const blurb =
    collection?.blurb ?? type?.blurb ?? 'Crewnecks, hoodies, quarter-zips, tees and jackets for every corner of Yale.'
  const cover = collection?.cover_image ?? type?.cover_image
  usePageTitle(title === 'The full lineup' ? 'Shop' : title)

  // Removable chips for whatever is narrowing the list.
  const chips: { label: string; clear: Partial<Filters> }[] = []
  if (filters.q) chips.push({ label: `“${filters.q}”`, clear: { q: '' } })
  for (const slug of filters.types)
    chips.push({
      label: cats?.types.find((t) => t.slug === slug)?.name ?? slug,
      clear: { types: filters.types.filter((t) => t !== slug) },
    })
  if (collection) chips.push({ label: collection.name, clear: { collection: null, aff: null } })
  if (filters.aff) chips.push({ label: filters.aff, clear: { aff: null } })
  for (const slug of filters.colours)
    chips.push({
      label: cats?.colours.find((c) => c.slug === slug)?.name ?? slug,
      clear: { colours: filters.colours.filter((c) => c !== slug) },
    })
  if (filters.size) chips.push({ label: `In stock in ${filters.size}`, clear: { size: null } })
  if (filters.maxPrice) chips.push({ label: `Up to ${formatPrice(filters.maxPrice)}`, clear: { maxPrice: null } })
  if (filters.inStock) chips.push({ label: 'In stock only', clear: { inStock: false } })
  const clearAll = () => setParams(writeFilters({ ...EMPTY_FILTERS, sort: filters.sort }), { preventScrollReset: true })
  const narrowing = activeCount(filters)

  return (
    <section className="section container shop">
      <header className={`shop-head glass${cover ? ' shop-head--cover' : ''}`}>
        <div className="shop-head__copy">
          <p className="eyebrow">Shop{collection && filters.aff ? ` · ${collection.name}` : ''}</p>
          <h1 key={title} className="shop-head__title">
            {title}
          </h1>
          <p className="lead">{blurb}</p>
          <form className="search" role="search" onSubmit={(event) => event.preventDefault()}>
            <SearchIcon size={18} />
            <label htmlFor="shop-search" className="visually-hidden">
              Search the shop
            </label>
            <input
              id="shop-search"
              type="search"
              placeholder="Search: bulldog, Morse, hockey, quarter-zip…"
              value={query.text}
              onChange={(event) => {
                setQuery({ seen: filters.q, text: event.target.value })
                set({ q: event.target.value }, true)
              }}
            />
          </form>
        </div>
        {cover && <img key={cover} className="shop-head__cover" src={cover} alt="" />}
      </header>

      <div className="shop-layout">
        <aside className={`filters glass${panelOpen ? ' is-open' : ''}`} aria-label="Filters">
          <div className="filters__head">
            <h2>Filters</h2>
            {narrowing > 0 && (
              <button type="button" className="text-button" onClick={clearAll}>
                Clear all
              </button>
            )}
            <button
              type="button"
              className="icon-button filters__close"
              aria-label="Close filters"
              onClick={() => setPanelOpen(false)}
            >
              <CloseIcon />
            </button>
          </div>
          {ready && cats ? (
            <FilterPanel products={all} cats={cats} filters={filters} set={set} onFindSize={() => setSizeHelp(true)} />
          ) : (
            <div className="filters__loading">
              <span className="skeleton skeleton--line" />
              <span className="skeleton skeleton--line skeleton--short" />
              <span className="skeleton skeleton--line" />
            </div>
          )}
          <button type="button" className="button button--block filters__done" onClick={() => setPanelOpen(false)}>
            Show {shown.length} {shown.length === 1 ? 'piece' : 'pieces'}
          </button>
        </aside>
        {panelOpen && (
          <button
            type="button"
            className="drawer-scrim filters__scrim"
            aria-label="Close filters"
            onClick={() => setPanelOpen(false)}
          />
        )}

        <div className="shop-results">
          <div className="shop-toolbar">
            <button
              type="button"
              className="button button--ghost shop-toolbar__filters"
              onClick={() => setPanelOpen(true)}
            >
              <FilterIcon size={18} /> Filters{narrowing > 0 ? ` (${narrowing})` : ''}
            </button>
            <p className="shop-toolbar__count" aria-live="polite">
              {ready ? (
                <>
                  <strong>{shown.length}</strong> of {all.length} pieces
                </>
              ) : (
                'Loading the lineup…'
              )}
            </p>
            <label className="sort">
              <span>Sort</span>
              <select value={filters.sort} onChange={(event) => set({ sort: event.target.value as SortKey })}>
                {SORTS.map((sort) => (
                  <option key={sort.key} value={sort.key}>
                    {sort.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {chips.length > 0 && (
            <ul className="active-chips" aria-label="Active filters">
              {chips.map((chip) => (
                <li key={chip.label}>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => set(chip.clear)}
                    aria-label={`Remove ${chip.label}`}
                  >
                    {chip.label} <CloseIcon size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(products.status === 'error' || categories.status === 'error') && (
            <p className="notice">We couldn't load the lineup right now. Please refresh to try again.</p>
          )}
          {!ready && products.status !== 'error' && categories.status !== 'error' && <SkeletonGrid />}
          {ready && shown.length > 0 && (
            <div className="product-grid">
              {shown.map((product, index) => (
                <ProductCard key={product.product_id} product={product} index={index} />
              ))}
            </div>
          )}
          {ready && shown.length === 0 && (
            <div className="glass empty-state">
              <DanAvatar size={96} mood="thinking" />
              <div>
                <h2>Nothing matches all of that.</h2>
                <p>I sniffed every shelf and came up empty. Try loosening a filter, or tell me what you're after.</p>
                <div className="button-row">
                  <button type="button" className="button" onClick={clearAll}>
                    Clear filters
                  </button>
                  <button type="button" className="button button--ghost" onClick={() => openChat(true)}>
                    Ask Dan
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <SizeHelper
        open={sizeHelp}
        onClose={() => setSizeHelp(false)}
        onChoose={(size) => set({ size })}
        chooseLabel={(size) => `Show what's in stock in ${size}`}
      />
    </section>
  )
}
