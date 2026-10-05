import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CartContext, stockIn, type CartItem, type CartNotice, type CartState } from './cartContext'

// The cart lives in this browser only (there's no online checkout yet), so it
// survives a refresh but isn't tied to an account.
const STORAGE_KEY = 'cc-cart-v1'
const MAX_PER_LINE = 10

function readCart(): CartItem[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((item) => item && item.productId && item.size && item.quantity > 0) : []
  } catch {
    return []
  }
}

const sameLine = (item: CartItem, productId: string, size: string) => item.productId === productId && item.size === size

const limit = (inStock: number) => Math.min(inStock, MAX_PER_LINE)

export default function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(readCart)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notice, setNotice] = useState<CartNotice | null>(null)
  // Mirrors `items` so add() can report what it did without waiting for a render.
  const itemsRef = useRef(items)
  const noticeId = useRef(0)

  useEffect(() => {
    itemsRef.current = items
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      // Storage blocked (private window): the cart still works until the tab closes.
    }
  }, [items])

  const value = useMemo<CartState>(() => {
    const update = (next: CartItem[]) => {
      itemsRef.current = next
      setItems(next)
    }

    return {
      items,
      count: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      add(product, size, quantity = 1) {
        const inStock = stockIn(product, size)
        const current = itemsRef.current
        const existing = current.find((item) => sameLine(item, product.product_id, size))
        const had = existing?.quantity ?? 0
        const wanted = Math.min(had + quantity, limit(inStock))
        const added = Math.max(0, wanted - had)
        const line: CartItem = {
          productId: product.product_id,
          size,
          quantity: wanted,
          name: product.name,
          price: product.price,
          imageUrl: product.image_url,
          garmentType: product.garment_type,
          inStock,
        }
        if (added > 0) {
          update(existing ? current.map((item) => (item === existing ? line : item)) : [...current, line])
        }
        let warning: string | undefined
        if (inStock === 0) warning = `Sorry, ${size} is sold out.`
        else if (added < quantity)
          warning =
            wanted >= inStock
              ? `Only ${inStock} left in ${size}, and they're all in your cart.`
              : `That's the most we can hold for one order (${MAX_PER_LINE}).`
        noticeId.current += 1
        setNotice({ id: noticeId.current, item: line, warning })
        return added
      },
      setQuantity(productId, size, quantity) {
        update(
          itemsRef.current.flatMap((item) => {
            if (!sameLine(item, productId, size)) return [item]
            const next = Math.min(Math.max(0, Math.round(quantity)), limit(item.inStock))
            return next > 0 ? [{ ...item, quantity: next }] : []
          }),
        )
      },
      remove(productId, size) {
        update(itemsRef.current.filter((item) => !sameLine(item, productId, size)))
      },
      clear() {
        update([])
      },
      sync(products) {
        const byId = new Map(products.map((product) => [product.product_id, product]))
        const current = itemsRef.current
        const next = current.map((item) => {
          const product = byId.get(item.productId)
          if (!product) return { ...item, inStock: 0 }
          const inStock = stockIn(product, item.size)
          return { ...item, name: product.name, price: product.price, imageUrl: product.image_url, inStock }
        })
        const changed = next.some(
          (item, i) =>
            item.inStock !== current[i].inStock || item.price !== current[i].price || item.name !== current[i].name,
        )
        if (changed) update(next)
      },
      drawerOpen,
      setDrawerOpen,
      notice,
      dismissNotice: () => setNotice(null),
    }
  }, [items, drawerOpen, notice])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
