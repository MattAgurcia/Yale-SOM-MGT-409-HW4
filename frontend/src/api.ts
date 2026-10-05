import { useEffect, useState } from 'react'

// ---- Types (mirror the Pydantic models in backend/models.py) ----

export interface SizeStock {
  size: string
  quantity: number
}

export interface Product {
  product_id: string
  name: string
  garment_type: string
  description: string
  colors: string[]
  search_tags: string[]
  image_file_path: string
  image_url: string
  price: number
  inventory: SizeStock[]
  total_stock: number
  /** Garment type slug for Shop by type: "hoodies", "crewnecks", "quarter-zips", "tees", "jackets". */
  category: string | null
  /** Collection slugs: "colleges", "sports", "schools", "family", "classics". */
  collections: string[]
  /** Its college, sport, school or family role within the collection: "Morse", "Hockey", "Mom". */
  affiliations: string[]
  /** The garment's own colour family, for the colour filter. */
  color_family: string | null
}

export interface LabelCount {
  label: string
  count: number
}

/** One shop category for the menu and the Categories page (models.CategoryInfo). */
export interface CategoryInfo {
  slug: string
  name: string
  blurb: string
  count: number
  cover_image: string | null
  affiliations: LabelCount[]
}

export interface ColourInfo {
  slug: string
  name: string
  count: number
}

/** GET /api/categories (models.ShopCategories). */
export interface ShopCategories {
  types: CategoryInfo[]
  collections: CategoryInfo[]
  colours: ColourInfo[]
}

export type FitPreference = 'snug' | 'regular' | 'relaxed'

/** POST /api/size-advice body (models.SizeAdviceRequest), in inches and pounds. */
export interface SizeAdviceRequest {
  height_in: number
  weight_lb: number
  chest_in?: number | null
  fit: FitPreference
  product_id?: string | null
}

export interface SizeChartRow {
  size: string
  chest_in: string
  height: string
  weight_lb: string
}

/** The size & fit helper's answer (models.SizeAdvice). */
export interface SizeAdvice {
  size: string
  alternative: string | null
  between_sizes: boolean
  explanation: string
  fit_note: string | null
  chart: SizeChartRow[]
  product_name: string | null
  in_stock: boolean | null
  quantity: number | null
  alternative_quantity: number | null
}

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

/** Search matches the chat wants laid out on the page as product cards. */
export interface ProductShowcase {
  title: string
  products: Product[]
}

/** A suggested product and why (models.RecommendedProduct). */
export interface RecommendedProduct {
  product: Product
  role: string
  reason: string
}

/** GET /api/products/{id}/recommendations (models.ProductRecommendations). */
export interface ProductRecommendations {
  product_id: string
  size: string | null
  size_sold_out: boolean
  similar: RecommendedProduct[]
  complete_the_look: RecommendedProduct[]
}

/** Where the shopper is when they send a message (models.PageContext). */
export interface PageContext {
  path: string
  product_id?: string
  showcase_title?: string
  showcase_product_ids?: string[]
}

/** One message from a logged-in shopper's saved chat (models.SavedChatMessage). */
export interface SavedChatMessage {
  id: number
  role: ChatRole
  content: string
  products: Product[]
  created_at: string
}

/** GET /api/chat/history (models.ChatHistory). Guests get saved=false and no messages. */
export interface ChatHistory {
  saved: boolean
  messages: SavedChatMessage[]
  memory: MemoryNotes | null
}

/** Recommended cards under a reply: alternatives or outfit pieces (models.SuggestionCards). */
export interface SuggestionCards {
  kind: 'similar' | 'complete_the_look'
  title: string
  items: RecommendedProduct[]
}

/** What one agent's run used (models.ModelUsage). */
export interface ModelUsage {
  agent: string
  model: string
  requests: number
  input_tokens: number
  cached_tokens: number
  output_tokens: number
}

/** Behind the scenes for one reply (models.ChatActivity). */
export interface ChatActivity {
  seconds: number
  agents: string[]
  usage: ModelUsage[]
}

/** Whether this browser's chat with Dan is open (models.ChatSession). An ended chat takes no messages until `until`. */
export interface ChatSession {
  ended: boolean
  /** Why it ended: an abusive message, or too many off-topic messages in a row. */
  reason: 'abusive' | 'off_topic_strikes' | null
  /** When a new chat can start (UTC, ISO 8601). */
  until: string | null
  /** Off-topic or manipulation messages in a row so far. */
  strikes: number
}

/** POST /api/chat response (models.ChatResponse). */
export interface ChatReply {
  reply: string
  /** Small cards shown under the reply inside the chat. */
  products: Product[]
  /** Set when the shopper browsed a kind of item; the page shows these cards. */
  showcase: ProductShowcase | null
  /** Alternatives (sold out / not carried) or outfit pieces, with reasons. */
  suggestions: SuggestionCards[]
  activity: ChatActivity | null
  /** Whether the chat is still open after this reply (the safety rules can end it). */
  session: ChatSession
  /** False when this exchange mustn't be sent back as history (blocked by the provider's filter, or it ended the chat). */
  keep_in_history: boolean
}

/** What the assistant remembers about a logged-in customer (models.MemoryNotes). */
export interface MemoryNotes {
  sizes: string[]
  likes: string[]
  avoids: string[]
  shopping_for: string[]
  considered: string[]
  notes: string
}

export interface TeamMember {
  id: string
  name: string
  model: string
  job: string
}

/** One step from POST /api/chat/stream (agent.EventSink). */
export type ChatEvent =
  | { type: 'team'; data: { t: number; members: TeamMember[] } }
  | { type: 'status'; data: { t: number; agent: string; state: 'thinking' | 'working' | 'done' } }
  | { type: 'delegate'; data: { t: number; from: string; to: string; task: string } }
  | { type: 'tool'; data: { t: number; agent: string; tool: string; summary: string } }
  | { type: 'report'; data: { t: number; from: string; to: string; summary: string; instant?: boolean } }
  | { type: 'final'; data: { t: number; response: ChatReply } }
  | { type: 'error'; data: { t: number; status: number; detail: string } }

export interface User {
  id: number
  first_name: string
  last_name: string
  name: string
  email: string
}

export interface SignupFields {
  first_name: string
  last_name: string
  email: string
  password: string
}

// ---- Requests ----

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The backend's error message: FastAPI's `detail`, either a string or a list of validation errors. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const { detail } = await res.json()
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '')
  } catch {
    // Not JSON; fall through to the generic message.
  }
  return 'Something went wrong. Please try again.'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return (res.status === 204 ? undefined : await res.json()) as T
}

const getJson = <T>(path: string) => request<T>(path)

const postJson = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const fetchProducts = () => getJson<Product[]>('/api/products')

export const fetchProduct = (productId: string) => getJson<Product>(`/api/products/${encodeURIComponent(productId)}`)

export const fetchCategories = () => getJson<ShopCategories>('/api/categories')

export const getSizeAdvice = (body: SizeAdviceRequest) => postJson<SizeAdvice>('/api/size-advice', body)

export const fetchRecommendations = (productId: string, size: string | null) =>
  getJson<ProductRecommendations>(
    `/api/products/${encodeURIComponent(productId)}/recommendations${size ? `?size=${size}` : ''}`,
  )

// Accounts. The session lives in an HttpOnly cookie the browser sends on its
// own; this code never sees the token.
export const fetchSession = () => getJson<{ user: User | null }>('/api/auth/me')

export const logIn = (email: string, password: string) => postJson<User>('/api/auth/login', { email, password })

export const signUp = (fields: SignupFields) => postJson<User>('/api/auth/signup', fields)

export const logOut = () => postJson<void>('/api/auth/logout')

/** Guests' chats aren't stored, so their messages carry the recent turns. (A logged-in shopper's come from the database.) */
export const CHAT_HISTORY_TURNS = 12

/** One shopper message to the agent (POST /api/chat), with the page they're on; returns its reply and product cards. */
export const sendChatMessage = (message: string, history: ChatMessage[], page: PageContext) =>
  postJson<ChatReply>('/api/chat', { message, history: history.slice(-CHAT_HISTORY_TURNS), page })

/**
 * The same message over POST /api/chat/stream: `onEvent` sees every step of the agent team as it
 * happens (for the live view), and the promise resolves with the final reply.
 */
export async function streamChatMessage(
  message: string,
  history: ChatMessage[],
  page: PageContext,
  onEvent: (event: ChatEvent) => void,
): Promise<ChatReply> {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history: history.slice(-CHAT_HISTORY_TURNS), page }),
  })
  if (!res.ok || !res.body) throw new ApiError(res.status, await errorMessage(res))

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      if (!block.startsWith('data: ')) continue
      const event = JSON.parse(block.slice(6)) as ChatEvent
      onEvent(event)
      if (event.type === 'final') return event.data.response
      if (event.type === 'error') throw new ApiError(event.data.status, event.data.detail)
    }
  }
  throw new ApiError(502, "Sorry, I couldn't answer just now. Please try again in a moment.")
}

export const fetchChatHistory = () => getJson<ChatHistory>('/api/chat/history')

/** Whether this browser's chat is open, so an ended chat stays ended after a reload. */
export const fetchChatSession = () => getJson<ChatSession>('/api/chat/session')

export const fetchMemory = () => getJson<MemoryNotes | null>('/api/chat/memory')

export const forgetMemory = () => request<void>('/api/chat/memory', { method: 'DELETE' })

export const clearChatHistory = () => request<void>('/api/chat/history', { method: 'DELETE' })

// ---- Hooks ----

export type Loadable<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; notFound: boolean }

function useLoad<T>(key: string, load: () => Promise<T>): Loadable<T> {
  const [result, setResult] = useState<{ key: string; value: Loadable<T> } | null>(null)

  useEffect(() => {
    let cancelled = false
    load().then(
      (data) => !cancelled && setResult({ key, value: { status: 'ready', data } }),
      (err: unknown) =>
        !cancelled &&
        setResult({ key, value: { status: 'error', notFound: err instanceof ApiError && err.status === 404 } }),
    )
    return () => {
      cancelled = true
    }
    // `key` identifies the request; `load` is a fresh closure every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // A result for a previous key (e.g. the last product) counts as still loading.
  return result?.key === key ? result.value : { status: 'loading' }
}

/**
 * One request shared by every caller. A good result is reused for a minute, so moving between
 * pages doesn't refetch the whole catalogue; a failed one is dropped at once so the next caller retries.
 */
function shared<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    if (!pending) {
      const request = load()
      pending = request
      const forget = () => {
        if (pending === request) pending = null
      }
      request.then(() => window.setTimeout(forget, 60_000), forget)
    }
    return pending
  }
}

const sharedProducts = shared(fetchProducts)
const sharedCategories = shared(fetchCategories)

export const useProducts = () => useLoad('products', sharedProducts)

export const useCategories = () => useLoad('categories', sharedCategories)

export const useProduct = (productId: string) => useLoad(`product:${productId}`, () => fetchProduct(productId))

export const useRecommendations = (productId: string, size: string | null) =>
  useLoad(`recs:${productId}:${size ?? ''}`, () => fetchRecommendations(productId, size))

export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · Campus Customs` : 'Campus Customs — Yale apparel from New Haven'
  }, [title])
}

// ---- Formatting ----

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export const formatPrice = (price: number) => usd.format(price)

/** At or below this many units, a size reads as "Only N left". */
export const LOW_STOCK = 5
