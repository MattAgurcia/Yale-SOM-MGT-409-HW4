import { createContext, useContext } from 'react'
import type { Product } from '../api'

/** One size of one product in the cart, with what it looked like when it was added. */
export interface CartItem {
  productId: string
  size: string
  quantity: number
  name: string
  price: number
  imageUrl: string
  garmentType: string
  /** Units on the shelf in this size, last we checked; the cart never holds more. */
  inStock: number
}

/** The latest add, for the "Added to your cart" toast. */
export interface CartNotice {
  id: number
  item: CartItem
  /** Set when the cart couldn't take the full amount ("Only 2 left in M"). */
  warning?: string
}

export interface CartState {
  items: CartItem[]
  /** Total units across every line. */
  count: number
  subtotal: number
  /** Adds `quantity` of a size; never more than the shelf holds. Returns how many were added. */
  add: (product: Product, size: string, quantity?: number) => number
  setQuantity: (productId: string, size: string, quantity: number) => void
  remove: (productId: string, size: string) => void
  clear: () => void
  /** Re-checks prices and stock against the live catalogue. */
  sync: (products: Product[]) => void
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
  notice: CartNotice | null
  dismissNotice: () => void
}

export const CartContext = createContext<CartState | null>(null)

export function useCart(): CartState {
  const cart = useContext(CartContext)
  if (!cart) throw new Error('useCart must be used inside <CartProvider>')
  return cart
}

export const stockIn = (product: Product, size: string) =>
  product.inventory.find((row) => row.size === size)?.quantity ?? 0
