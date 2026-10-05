/**
 * The "fly to cart" flourish: a copy of the product photo arcs from where the
 * shopper clicked into the cart button in the header, which then bounces.
 */

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Bounce the header cart button (CSS: .cart-button.is-bumped). */
export function bumpCart(): void {
  const target = document.querySelector<HTMLElement>('[data-cart-target]')
  if (!target) return
  target.classList.remove('is-bumped')
  void target.offsetWidth // restart the animation
  target.classList.add('is-bumped')
}

/** `from` is any element inside the product card (or page) whose photo should fly. */
export function flyToCart(from: Element | null): void {
  const source = from?.closest('[data-cart-source]')?.querySelector('img')
  const target = document.querySelector<HTMLElement>('[data-cart-target]')
  if (!source || !target || prefersReducedMotion()) {
    bumpCart()
    return
  }

  const start = source.getBoundingClientRect()
  const end = target.getBoundingClientRect()
  const size = Math.min(start.width, start.height, 160)
  const clone = source.cloneNode() as HTMLImageElement
  clone.removeAttribute('loading')
  clone.alt = ''
  clone.className = 'cart-flyer'
  Object.assign(clone.style, {
    left: `${start.left + (start.width - size) / 2}px`,
    top: `${start.top + (start.height - size) / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
  })
  document.body.appendChild(clone)

  const dx = end.left + end.width / 2 - (start.left + start.width / 2)
  const dy = end.top + end.height / 2 - (start.top + start.height / 2)
  const animation = clone.animate(
    [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      {
        transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 90}px) scale(0.6) rotate(-8deg)`,
        opacity: 1,
        offset: 0.45,
      },
      { transform: `translate(${dx}px, ${dy}px) scale(0.12) rotate(12deg)`, opacity: 0.4 },
    ],
    { duration: 720, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' },
  )
  animation.onfinish = () => {
    clone.remove()
    bumpCart()
  }
  animation.oncancel = () => clone.remove()
}
