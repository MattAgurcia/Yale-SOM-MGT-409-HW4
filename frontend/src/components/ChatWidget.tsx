import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Markdown from 'react-markdown'
import { Link, useLocation } from 'react-router'
import {
  ApiError,
  clearChatHistory,
  fetchChatHistory,
  fetchChatSession,
  fetchMemory,
  forgetMemory,
  formatPrice,
  streamChatMessage,
  type ChatActivity,
  type ChatEvent,
  type ChatMessage,
  type ChatSession,
  type MemoryNotes,
  type PageContext,
  type Product,
  type ProductShowcase,
  type SuggestionCards,
} from '../api'
import { useAuth } from '../auth/useAuth'
import { useChat } from '../chat/chatContext'
import { chime, isMuted, setMuted, unlockSound, woof } from '../chat/teamSound'
import AddToCart from './AddToCart'
import DanAvatar from './DanAvatar'
import DanLauncher from './DanLauncher'
import { CloseIcon } from './Icons'
import TeamActivity, { ActivitySummary } from './TeamActivity'

interface ChatEntry extends ChatMessage {
  products?: Product[]
  /** Set when this reply put a showcase on the page: its title and size. */
  showcase?: { title: string; count: number }
  /** Alternatives or outfit pieces shown under the reply, with reasons. */
  suggestions?: SuggestionCards[]
  /** Who worked on the reply and what it used, plus the steps they took. */
  activity?: ChatActivity
  trace?: ChatEvent[]
  /** Failed requests show in the thread but aren't sent back as history. */
  error?: boolean
  /** Shown, but not sent back as history: the server said so, or it's from before the chat was ended. */
  omit?: boolean
  /** Reloaded from the customer's saved chat (an earlier visit). */
  saved?: boolean
}

// The backend accepts plain paths and titles only (models.PageContext).
const SAFE_PATH = /^\/[A-Za-z0-9/_-]*$/
const PRODUCT_PAGE = /^\/products\/([a-z0-9-]+)$/

/** What the agent should know about the page: the product being viewed, and the chat's shelf if it's showing. */
function pageContext(pathname: string, showcase: ProductShowcase | null): PageContext {
  const page: PageContext = { path: SAFE_PATH.test(pathname) ? pathname : '/' }
  const product = pathname.match(PRODUCT_PAGE)
  if (product) page.product_id = product[1]
  if (showcase) {
    page.showcase_title = showcase.title.replace(/[^\w $&'.,/()+-]/g, ' ').slice(0, 60)
    page.showcase_product_ids = showcase.products.map((p) => p.product_id)
  }
  return page
}

// The agent writes light markdown; anything beyond these tags is shown as plain text.
const MARKDOWN_TAGS = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'code']

/** A small product card in the chat: opens the product's page, with its own Add to cart. */
function ChatCard({
  product,
  onOpen,
  role,
  reason,
}: {
  product: Product
  onOpen: () => void
  role?: string
  reason?: string
}) {
  return (
    <li className="chat-card" data-cart-source>
      <img src={product.image_url} alt="" loading="lazy" />
      <span className="chat-card__text">
        {role && <span className="chat-card__role">{role}</span>}
        <Link to={`/products/${product.product_id}`} className="chat-card__name" onClick={onOpen}>
          {product.name}
        </Link>
        {reason && <span className="chat-card__reason">{reason}</span>}
        <span className="chat-card__meta">
          {formatPrice(product.price)}
          {!role && ` · ${product.total_stock > 0 ? `${product.total_stock} in stock` : 'Sold out'}`}
        </span>
      </span>
      <AddToCart product={product} variant="compact" />
    </li>
  )
}

function ProductCards({ products, onOpen }: { products: Product[]; onOpen: () => void }) {
  return (
    <ul className="chat-cards">
      {products.map((product) => (
        <ChatCard key={product.product_id} product={product} onOpen={onOpen} />
      ))}
    </ul>
  )
}

function Suggestions({ groups, onOpen }: { groups: SuggestionCards[]; onOpen: () => void }) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.title} className={`chat-suggest chat-suggest--${group.kind}`}>
          <p className="chat-suggest__title">{group.title}</p>
          <ul className="chat-cards">
            {group.items.map(({ product, role, reason }) => (
              <ChatCard key={product.product_id} product={product} onOpen={onOpen} role={role} reason={reason} />
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

/** "Size M · Likes navy · Shopping for Dad": what the assistant remembers, as one line. */
function memoryLine(memory: MemoryNotes): string {
  const parts = [
    memory.sizes.length ? `Size ${memory.sizes.join('/')}` : '',
    memory.likes.length ? `Likes ${memory.likes.slice(0, 3).join(', ')}` : '',
    memory.shopping_for.length ? `Shopping for ${memory.shopping_for.join(', ')}` : '',
    memory.avoids.length ? `Not ${memory.avoids.slice(0, 2).join(', ')}` : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

/** "4:15 PM": when an ended chat can start again, in the shopper's own time zone. */
function reopensAt(session: ChatSession): string {
  return session.until ? new Date(session.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'soon'
}

/** Conversation starters under Dan's greeting, before the first message. */
function starters(onProductPage: boolean): string[] {
  return onProductPage
    ? ['What goes with this?', 'What size should I get?', 'Is this in stock in M?']
    : ['What hoodies do you have?', 'Help me find my size', 'Gift ideas for my dad', 'Show me Morse gear']
}

export default function ChatWidget() {
  const { user } = useAuth()
  const { open, setOpen, showcase, showOnPage, reveal } = useChat()
  const { pathname } = useLocation()
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  // Steps streamed from the shop team while a reply is being worked on.
  const [live, setLive] = useState<ChatEvent[]>([])
  const [memory, setMemory] = useState<MemoryNotes | null>(null)
  // The safety rules can end a chat (rudeness, or repeated off-topic requests); the server decides.
  const [session, setSession] = useState<ChatSession | null>(null)
  const [soundOn, setSoundOn] = useState(!isMuted())
  // Dan pants happily for a moment after each reply.
  const [cheering, setCheering] = useState(false)
  const cheerTimer = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endedRef = useRef<HTMLDivElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  const onProductPage = PRODUCT_PAGE.test(pathname)
  const ended = session?.ended ?? false
  const mood = pending ? 'thinking' : cheering && !ended ? 'happy' : 'idle'

  // When a chat ends, everything said so far stays on screen but is never sent again, so the
  // next chat really starts fresh. Adjusted while rendering, not in an effect.
  const [wasEnded, setWasEnded] = useState(false)
  if (ended !== wasEnded) {
    setWasEnded(ended)
    if (ended) setEntries((current) => current.map((entry) => ({ ...entry, omit: true })))
  }
  const hasSaved = entries.some((entry) => entry.saved)

  // A different shopper (log in, log out) starts with an empty thread, so no
  // one sees the last person's chat. Adjusted while rendering, not in an effect.
  const userId = user?.id ?? null
  const [owner, setOwner] = useState(userId)
  if (owner !== userId) {
    setOwner(userId)
    setEntries([])
    setMemory(null)
  }

  // A logged-in customer's saved chat is loaded back in, ahead of anything
  // they've already typed while it was loading.
  useEffect(() => {
    if (userId === null) return
    let cancelled = false
    fetchChatHistory().then(
      ({ messages, memory: remembered }) => {
        if (cancelled) return
        const saved: ChatEntry[] = messages.map(({ role, content, products }) => ({
          role,
          content,
          products,
          saved: true,
        }))
        setEntries((current) => [...saved, ...current])
        setMemory(remembered)
      },
      () => {
        // History is a nice-to-have; the chat still works without it.
      },
    )
    return () => {
      cancelled = true
    }
  }, [userId])

  // Ask whether this browser's chat is open when the panel opens or the shopper changes,
  // so a chat Dan ended stays ended after a reload.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchChatSession().then(
      (state) => !cancelled && setSession(state),
      () => {
        // If the check fails, the server still refuses messages to an ended chat.
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, userId])

  // An ended chat opens again by itself once its time is up. If the server still says ended (its
  // clock is ahead) or can't be reached, check again every 15 seconds.
  const until = ended ? session?.until : null
  const [recheck, setRecheck] = useState(0)
  useEffect(() => {
    if (!until) return
    const wait = Math.max(0, new Date(until).getTime() - Date.now()) + 1000
    const timer = window.setTimeout(
      () => {
        fetchChatSession().then(
          (state) => {
            setSession(state)
            if (state.ended) setRecheck((n) => n + 1)
          },
          () => setRecheck((n) => n + 1),
        )
      },
      recheck === 0 ? wait : Math.max(wait, 15000),
    )
    return () => window.clearTimeout(timer)
  }, [until, recheck])

  // Focus the input on open (or the notice, if the chat has ended); hand focus back to the launcher on close.
  useEffect(() => {
    if (open) (inputRef.current ?? endedRef.current)?.focus()
    else if (wasOpen.current) launcherRef.current?.focus()
    wasOpen.current = open
  }, [open])

  // The input is swapped for the notice when a chat ends, and back when it reopens: keep focus in the panel.
  useEffect(() => {
    if (!open) return
    if (ended) endedRef.current?.focus()
    else inputRef.current?.focus()
  }, [ended, open])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [entries, pending, open, live])

  useEffect(() => () => window.clearTimeout(cheerTimer.current), [])

  const close = () => setOpen(false)

  async function openChat() {
    setOpen(true)
    await unlockSound() // the click is the gesture browsers require before sound
    woof()
  }

  // On a phone the panel covers the page, so close it when a card is opened.
  const closeIfFullScreen = () => {
    if (window.matchMedia('(max-width: 600px)').matches) close() // the chat fills the screen at this width (styles.css)
  }

  async function send(event?: FormEvent, starter?: string) {
    event?.preventDefault()
    const text = (starter ?? draft).trim()
    if (!text || pending || ended) return

    // Guests send their recent turns; a logged-in customer's come from the database.
    const history: ChatMessage[] = user
      ? []
      : entries.filter((e) => !e.error && !e.omit).map(({ role, content }) => ({ role, content }))
    const asked = entries.length // where this message lands in the thread
    setEntries((current) => [...current, { role: 'user', content: text }])
    setDraft('')
    setPending(true)
    setLive([])
    void unlockSound() // this keypress / click is the gesture browsers require before sound
    const trace: ChatEvent[] = []
    try {
      const reply = await streamChatMessage(text, history, pageContext(pathname, showcase), (event) => {
        if (event.type === 'final' || event.type === 'error') return
        trace.push(event)
        setLive([...trace])
      })
      setSession(reply.session)
      chime()
      setCheering(true)
      window.clearTimeout(cheerTimer.current)
      cheerTimer.current = window.setTimeout(() => setCheering(false), 2600)
      // Browse results go onto the page itself; the chat keeps a link to them.
      if (reply.showcase) showOnPage(reply.showcase)
      const summary = reply.showcase
        ? { title: reply.showcase.title, count: reply.showcase.products.length }
        : undefined
      const entry: ChatEntry = {
        role: 'assistant',
        content: reply.reply,
        products: reply.products,
        showcase: summary,
        suggestions: reply.suggestions,
        activity: reply.activity ?? undefined,
        trace,
        omit: !reply.keep_in_history,
      }
      setEntries((current) => [
        ...current.map((e, i) => (i === asked && !reply.keep_in_history ? { ...e, omit: true } : e)),
        entry,
      ])
      // The memory clerk updates in the background after the reply; pick up its notes shortly.
      if (user) window.setTimeout(() => void fetchMemory().then(setMemory, () => {}), 4000)
    } catch (err) {
      const content =
        err instanceof ApiError
          ? err.message
          : "Sorry, I couldn't reach the shop just now. Please try again in a moment."
      setEntries((current) => [...current, { role: 'assistant', content, error: true }])
      // 423: this chat was already ended (in another tab, say). Show it as ended.
      if (err instanceof ApiError && err.status === 423) void fetchChatSession().then(setSession, () => {})
    } finally {
      setPending(false)
    }
  }

  async function forget() {
    try {
      await forgetMemory()
      setMemory(null)
    } catch {
      // Leave the notes showing; the shopper can try again.
    }
  }

  function toggleSound() {
    setMuted(soundOn)
    setSoundOn(!soundOn)
  }

  async function clearSaved() {
    if (!window.confirm('Delete your saved chat history and what I remember? This can’t be undone.')) return
    try {
      await clearChatHistory()
      setEntries([])
      setMemory(null)
    } catch {
      setEntries((current) => [
        ...current,
        { role: 'assistant', content: "Sorry, I couldn't clear your history just now.", error: true },
      ])
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter makes a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  if (!open) return <DanLauncher buttonRef={launcherRef} onOpen={() => void openChat()} />

  return (
    <section
      id="chat-panel"
      className="chat-panel"
      role="dialog"
      aria-label="Chat with Dan, the Campus Customs bulldog"
      onKeyDown={(event) => event.key === 'Escape' && close()}
    >
      <header className="chat-panel__header">
        <div className="chat-panel__who">
          <span className="chat-panel__avatar">
            <DanAvatar size={46} mood={mood} />
          </span>
          <div>
            <h2 className="chat-panel__title">Dan</h2>
            <p className="chat-panel__subtitle">
              <span
                className={`chat-panel__dot${pending ? ' is-busy' : ended ? ' is-ended' : ''}`}
                aria-hidden="true"
              />
              {pending ? 'Sniffing around the shelves…' : ended ? 'Chat ended' : 'Your Campus Customs bulldog'}
            </p>
          </div>
        </div>
        <div className="chat-panel__tools">
          <button
            type="button"
            className="chat-panel__clear"
            aria-pressed={soundOn}
            aria-label={soundOn ? 'Turn team sounds off' : 'Turn team sounds on'}
            onClick={toggleSound}
          >
            {soundOn ? 'Sound on' : 'Sound off'}
          </button>
          {user && entries.length > 0 && (
            <button
              type="button"
              className="chat-panel__clear"
              aria-label="Clear saved chat history"
              onClick={() => void clearSaved()}
            >
              Clear
            </button>
          )}
          <button type="button" className="chat-panel__close" aria-label="Close chat" onClick={close}>
            <CloseIcon size={18} />
          </button>
        </div>
      </header>

      <div className="chat-panel__messages" ref={listRef} aria-live="polite">
        <div className="chat-turn chat-turn--greeting">
          <DanAvatar size={30} className="chat-turn__avatar" />
          <div className="chat-msg chat-msg--assistant">
            <p>
              <strong>Woof woof{user ? `, ${user.first_name}` : ''}!</strong> 🐾 I'm Dan, the Campus Customs bulldog.
            </p>
            <p>How can I help? Ask me about styles, sizes, gifts, or what's in stock.</p>
          </div>
          {entries.length === 0 && !pending && !ended && (
            <ul className="chat-starters" aria-label="Try asking">
              {starters(onProductPage).map((text, index) => (
                <li key={text} style={{ animationDelay: `${200 + index * 70}ms` }}>
                  <button type="button" onClick={() => void send(undefined, text)}>
                    {text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="chat-note">
          {user ? 'Your chats are saved to your account.' : 'Log in to save this chat for next time.'}
        </p>
        {user && memory && memoryLine(memory) && (
          <div className="chat-memory">
            <p>
              <span className="chat-memory__label">I remember</span> {memoryLine(memory)}
            </p>
            <button type="button" className="chat-memory__forget" onClick={() => void forget()}>
              Forget
            </button>
          </div>
        )}
        {hasSaved && <p className="chat-divider">Earlier chats</p>}
        {entries.map((entry, index) =>
          entry.role === 'user' ? (
            <div key={index} className="chat-msg chat-msg--user">
              {entry.content}
            </div>
          ) : (
            <div key={index} className="chat-turn">
              <DanAvatar size={30} className="chat-turn__avatar" />
              <div className={`chat-msg chat-msg--assistant${entry.error ? ' chat-msg--error' : ''}`}>
                <Markdown allowedElements={MARKDOWN_TAGS} unwrapDisallowed>
                  {entry.content}
                </Markdown>
              </div>
              {entry.products && entry.products.length > 0 && (
                <ProductCards products={entry.products} onOpen={closeIfFullScreen} />
              )}
              {entry.suggestions && entry.suggestions.length > 0 && (
                <Suggestions groups={entry.suggestions} onOpen={closeIfFullScreen} />
              )}
              {entry.showcase && (
                <button
                  type="button"
                  className="chat-showcase-link"
                  onClick={() => {
                    reveal()
                    closeIfFullScreen()
                  }}
                >
                  See all {entry.showcase.count} {entry.showcase.title.toLowerCase()} on the page ↑
                </button>
              )}
              {entry.activity && entry.trace && <ActivitySummary activity={entry.activity} trace={entry.trace} />}
            </div>
          ),
        )}
        {pending && <TeamActivity events={live} />}
      </div>

      {session && ended ? (
        <div className="chat-ended" role="status" tabIndex={-1} ref={endedRef}>
          <p>
            <strong>Dan ended this chat.</strong>{' '}
            {session.reason === 'abusive'
              ? "Let's keep things friendly."
              : 'He can only help with Campus Customs shopping.'}{' '}
            You can start a new chat at {reopensAt(session)}.
          </p>
        </div>
      ) : (
        <form className="chat-panel__form" onSubmit={send}>
          <label htmlFor="chat-input" className="visually-hidden">
            Your message
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={2}
            maxLength={1000}
            value={draft}
            placeholder="Ask Dan about a hoodie, a size, a color…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onInputKeyDown}
          />
          <button type="submit" className="button" disabled={!draft.trim() || pending}>
            Send
          </button>
        </form>
      )}
    </section>
  )
}
