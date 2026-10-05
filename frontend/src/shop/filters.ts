import type { Product } from '../api'

/**
 * The Products page's filters and sort, kept in the URL so a filtered view can
 * be shared, bookmarked, linked from the Categories menu, and survives Back.
 *
 *   ?type=hoodies,tees  &collection=colleges  &aff=Morse  &color=navy,gray
 *   &size=M  &max=60  &stock=1  &q=bulldog  &sort=price-asc
 */

export type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'name' | 'stock'

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'featured', label: 'Featured' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
  { key: 'name', label: 'Name: A to Z' },
  { key: 'stock', label: 'Best stocked' },
]

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

/** Swatch colours for the colour filter (the garment's own colour family). */
export const SWATCHES: Record<string, string> = {
  navy: '#14284b',
  gray: '#b9bdc4',
  charcoal: '#4a4e55',
  cream: '#f3ecdc',
  coral: '#ef8a76',
}

export interface Filters {
  q: string
  types: string[]
  collection: string | null
  aff: string | null
  colours: string[]
  size: string | null
  maxPrice: number | null
  inStock: boolean
  sort: SortKey
}

const list = (value: string | null) => (value ? value.split(',').filter(Boolean) : [])

export function readFilters(params: URLSearchParams): Filters {
  const sort = params.get('sort') as SortKey | null
  const max = Number(params.get('max'))
  const size = params.get('size')
  return {
    q: params.get('q') ?? '',
    types: list(params.get('type')),
    collection: params.get('collection'),
    aff: params.get('collection') ? params.get('aff') : null,
    colours: list(params.get('color')),
    size: size && SIZES.includes(size) ? size : null,
    maxPrice: Number.isFinite(max) && max > 0 ? max : null,
    inStock: params.get('stock') === '1',
    sort: SORTS.some((s) => s.key === sort) ? (sort as SortKey) : 'featured',
  }
}

export function writeFilters(f: Filters): URLSearchParams {
  const params = new URLSearchParams()
  if (f.q.trim()) params.set('q', f.q)
  if (f.types.length) params.set('type', f.types.join(','))
  if (f.collection) params.set('collection', f.collection)
  if (f.collection && f.aff) params.set('aff', f.aff)
  if (f.colours.length) params.set('color', f.colours.join(','))
  if (f.size) params.set('size', f.size)
  if (f.maxPrice) params.set('max', String(f.maxPrice))
  if (f.inStock) params.set('stock', '1')
  if (f.sort !== 'featured') params.set('sort', f.sort)
  return params
}

export const EMPTY_FILTERS: Filters = readFilters(new URLSearchParams())

/** How many filters are narrowing the list (not counting sort or search). */
export const activeCount = (f: Filters) =>
  f.types.length +
  (f.collection ? 1 : 0) +
  (f.aff ? 1 : 0) +
  f.colours.length +
  (f.size ? 1 : 0) +
  (f.maxPrice ? 1 : 0) +
  (f.inStock ? 1 : 0)

const haystack = (p: Product) =>
  [p.name, p.garment_type, p.description, ...p.colors, ...p.search_tags, ...p.affiliations].join(' ').toLowerCase()

const inStockIn = (p: Product, size: string) => p.inventory.some((row) => row.size === size && row.quantity > 0)

/** Products matching every filter except those in `skip` (for the counts next to a filter's options). */
export function applyFilters(products: Product[], f: Filters, ...skip: (keyof Filters)[]): Product[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean)
  const on = (key: keyof Filters) => !skip.includes(key)
  return products.filter(
    (p) =>
      (!on('q') || words.every((word) => haystack(p).includes(word))) &&
      (!on('types') || !f.types.length || (p.category !== null && f.types.includes(p.category))) &&
      (!on('collection') || !f.collection || p.collections.includes(f.collection)) &&
      (!on('aff') || !f.aff || p.affiliations.includes(f.aff)) &&
      (!on('colours') || !f.colours.length || (p.color_family !== null && f.colours.includes(p.color_family))) &&
      (!on('size') || !f.size || inStockIn(p, f.size)) &&
      (!on('maxPrice') || !f.maxPrice || p.price <= f.maxPrice) &&
      (!on('inStock') || !f.inStock || p.total_stock > 0),
  )
}

export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const sorted = [...products]
  const byName = (a: Product, b: Product) => a.name.localeCompare(b.name)
  switch (sort) {
    case 'price-asc':
      return sorted.sort((a, b) => a.price - b.price || byName(a, b))
    case 'price-desc':
      return sorted.sort((a, b) => b.price - a.price || byName(a, b))
    case 'name':
      return sorted.sort(byName)
    case 'stock':
      return sorted.sort((a, b) => b.total_stock - a.total_stock || byName(a, b))
    default:
      // Featured: what you can buy first, then the shop's own order.
      return sorted.sort((a, b) => Number(b.total_stock > 0) - Number(a.total_stock > 0))
  }
}

/** Option -> how many products it would show, given every other filter. */
export function countBy(products: Product[], key: (p: Product) => string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const product of products) for (const value of key(product)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}
