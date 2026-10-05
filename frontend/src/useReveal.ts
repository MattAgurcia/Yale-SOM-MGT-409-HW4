import { useEffect } from 'react'

/**
 * Scroll reveal: anything with class "reveal" fades and rises into place the
 * first time it scrolls into view (styles.css). One IntersectionObserver for
 * the page, plus a MutationObserver so content that loads later is picked up.
 * Without IntersectionObserver, or with reduced motion, everything just shows.
 */
export function useReveal(): void {
  useEffect(() => {
    const root = document.documentElement
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    root.classList.add('can-reveal')

    const seen = new WeakSet<Element>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-revealed')
          io.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    )
    const scan = () => {
      for (const el of document.querySelectorAll('.reveal:not(.is-revealed)')) {
        if (seen.has(el)) continue
        seen.add(el)
        io.observe(el)
      }
    }
    scan()
    const mo = new MutationObserver(scan)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      io.disconnect()
      mo.disconnect()
      root.classList.remove('can-reveal')
    }
  }, [])
}
