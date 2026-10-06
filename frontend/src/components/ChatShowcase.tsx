import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { useChat } from '../chat/chatContext'
import { ArrowRightIcon } from './Icons'
import ProductCard from './ProductCard'

/** Glide only for shoppers who haven't asked their system to reduce motion. */
const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

const onProductPage = (pathname: string) => pathname.startsWith('/products/')

/**
 * "From your chat": the products the assistant found for a browse question
 * ("what hoodies do you have?"), laid out at the top of whatever page is open.
 * Each card is the same ProductCard the Products page uses, so clicking one
 * opens that product's page.
 */
export default function ChatShowcase() {
  const { showcase, revealCount, clearShowcase, open: chatOpen } = useChat()
  const { pathname } = useLocation()
  const sectionRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Open or folded follows whatever happened last. New results (or "see them
  // on the page" in the chat) open the shelf. Opening a product's own page
  // folds it to one line so the item comes first; other pages open it again.
  // Adjusted while rendering, the way React recommends for state that follows props.
  const [view, setView] = useState({ pathname, revealCount, expanded: !onProductPage(pathname) })
  let expanded = view.expanded
  if (view.pathname !== pathname || view.revealCount !== revealCount) {
    expanded = view.revealCount !== revealCount ? true : !onProductPage(pathname)
    setView({ pathname, revealCount, expanded })
  }
  const toggle = () => setView((current) => ({ ...current, expanded: !current.expanded }))

  // On a reveal, rewind the row to the first card and bring the shelf into view.
  useEffect(() => {
    if (revealCount === 0) return
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ left: 0 })
      sectionRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    })
  }, [revealCount])

  if (!showcase) return null

  const count = showcase.products.length
  const scrollList = (direction: 1 | -1) => {
    const list = listRef.current
    if (list) list.scrollBy({ left: direction * list.clientWidth * 0.8, behavior: scrollBehavior() })
  }

  return (
    <section
      ref={sectionRef}
      className={`showcase${chatOpen ? ' showcase--beside-chat' : ''}`}
      aria-labelledby="showcase-title"
    >
      <div className="container">
        <div className="showcase__inner glass">
          <div className="showcase__head">
            <div>
              <p className="eyebrow">Dan fetched these</p>
              <h2 id="showcase-title" className="showcase__title">
                {showcase.title}
                <span className="showcase__count">
                  {count} {count === 1 ? 'match' : 'matches'}
                </span>
              </h2>
            </div>
            <div className="showcase__actions">
              {expanded && count > 1 && (
                <>
                  <button
                    type="button"
                    className="showcase__arrow"
                    aria-label="Scroll left"
                    onClick={() => scrollList(-1)}
                  >
                    <ArrowRightIcon size={18} style={{ transform: 'scaleX(-1)' }} />
                  </button>
                  <button
                    type="button"
                    className="showcase__arrow"
                    aria-label="Scroll right"
                    onClick={() => scrollList(1)}
                  >
                    <ArrowRightIcon size={18} />
                  </button>
                </>
              )}
              <button
                type="button"
                className="showcase__action"
                aria-expanded={expanded}
                aria-controls="showcase-list"
                onClick={toggle}
              >
                {expanded ? 'Hide' : 'Show'}
              </button>
              <button type="button" className="showcase__action" onClick={clearShowcase}>
                Clear
              </button>
            </div>
          </div>
          {expanded && (
            <ul id="showcase-list" ref={listRef} className="showcase__list">
              {showcase.products.map((product, index) => (
                <li key={product.product_id}>
                  <ProductCard product={product} showInfo index={index} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
