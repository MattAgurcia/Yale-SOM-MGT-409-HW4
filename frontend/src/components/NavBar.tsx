import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { useCategories } from '../api'
import { useAuth } from '../auth/useAuth'
import { useCart } from '../cart/cartContext'
import { ArrowRightIcon, BagIcon, ChevronDownIcon, CloseIcon, MenuIcon } from './Icons'

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav__link is-active' : 'nav__link')

/** The Categories mega menu: Shop by type and Collections, each with its product count. */
function CategoryLinks({ onPick }: { onPick?: () => void }) {
  const categories = useCategories()
  if (categories.status !== 'ready') return <p className="mega__loading">Loading categories…</p>
  const { types, collections } = categories.data

  return (
    <div className="mega__columns">
      <div className="mega__column">
        <p className="mega__heading">Shop by type</p>
        <ul>
          {types.map((type, i) => (
            <li key={type.slug} style={{ animationDelay: `${i * 35}ms` }}>
              <Link to={`/products?type=${type.slug}`} className="mega__link" onClick={onPick}>
                {type.cover_image && <img src={type.cover_image} alt="" />}
                <span>{type.name}</span>
                <span className="mega__count">{type.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="mega__column">
        <p className="mega__heading">Collections</p>
        <ul>
          {collections.map((collection, i) => (
            <li key={collection.slug} style={{ animationDelay: `${(i + types.length) * 35}ms` }}>
              <Link to={`/products?collection=${collection.slug}`} className="mega__link" onClick={onPick}>
                {collection.cover_image && <img src={collection.cover_image} alt="" />}
                <span>{collection.name}</span>
                <span className="mega__count">{collection.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="mega__feature">
        <p className="mega__heading">Not sure where to start?</p>
        <p>See every category with its colleges, teams and schools, or browse the whole lineup.</p>
        <Link to="/categories" className="text-link" onClick={onPick}>
          All categories <ArrowRightIcon size={16} />
        </Link>
        <Link to="/products" className="text-link" onClick={onPick}>
          Shop all products <ArrowRightIcon size={16} />
        </Link>
      </div>
    </div>
  )
}

export default function NavBar() {
  const { user, ready, logOut } = useAuth()
  const cart = useCart()
  const location = useLocation()
  const [megaOpen, setMegaOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(() => window.scrollY > 8)
  const megaRef = useRef<HTMLLIElement>(null)
  const hoverTimer = useRef(0)
  // When hovering last opened the menu, so a click right after doesn't close it again.
  const hoverOpenedAt = useRef(-Infinity)

  // Any navigation closes the menus. Adjusted while rendering, not in an effect.
  const here = location.pathname + location.search
  const [lastHere, setLastHere] = useState(here)
  if (lastHere !== here) {
    setLastHere(here)
    setMegaOpen(false)
    setMobileOpen(false)
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!megaOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!megaRef.current?.contains(event.target as Node)) setMegaOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMegaOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [megaOpen])

  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  // Hovering opens the menu after a beat and leaving closes it after a beat, so passing through doesn't flicker.
  const hover = (open: boolean) => {
    if (!window.matchMedia('(hover: hover)').matches) return
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(
      () => {
        if (open) hoverOpenedAt.current = performance.now()
        setMegaOpen(open)
      },
      open ? 120 : 220,
    )
  }

  const clickCategories = () => {
    window.clearTimeout(hoverTimer.current)
    const justHovered = performance.now() - hoverOpenedAt.current < 700
    setMegaOpen((open) => (open && justHovered ? true : !open))
  }

  // A category view (the Categories page, or the shop filtered by type / collection / colour) lights
  // up Categories in the menu instead of Products.
  const onCategories =
    location.pathname === '/categories' ||
    (location.pathname === '/products' && /[?&](type|collection|color)=/.test(location.search))

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="container site-header__bar">
        {/* Its frosted background is a ::before layer, so the mega menu inside can frost the page too. */}
        <div className="site-header__inner">
          <Link to="/" className="wordmark" aria-label="Campus Customs home">
            <span className="wordmark__mark" aria-hidden="true">
              Y
            </span>
            <span className="wordmark__text">
              <span className="wordmark__name">Campus Customs</span>
              <span className="wordmark__tag">Yale apparel · New Haven</span>
            </span>
          </Link>

          <nav className="nav" aria-label="Main">
            <ul className="nav__links">
              <li>
                <NavLink to="/" end className={navClass}>
                  Home
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/products"
                  end
                  className={({ isActive }) => navClass({ isActive: isActive && !onCategories })}
                >
                  Products
                </NavLink>
              </li>
              <li
                ref={megaRef}
                className="nav__mega"
                onMouseEnter={() => hover(true)}
                onMouseLeave={() => hover(false)}
              >
                <button
                  type="button"
                  className={`nav__link nav__link--button${megaOpen || onCategories ? ' is-active' : ''}`}
                  aria-expanded={megaOpen}
                  aria-controls="mega-menu"
                  onClick={clickCategories}
                >
                  Categories <ChevronDownIcon size={16} className="nav__chevron" />
                </button>
                {megaOpen && (
                  <div id="mega-menu" className="mega glass">
                    <CategoryLinks onPick={() => setMegaOpen(false)} />
                  </div>
                )}
              </li>
              <li>
                <NavLink to="/about" className={navClass}>
                  About Us
                </NavLink>
              </li>
            </ul>
          </nav>

          <div className="nav__account">
            {/* Left empty until the session check returns, so links don't flicker. */}
            {ready && user && (
              <>
                <span className="nav__greeting">Hi, {user.first_name}</span>
                <button type="button" className="nav__link nav__link--button" onClick={() => void logOut()}>
                  Log out
                </button>
              </>
            )}
            {ready && !user && (
              <>
                <NavLink to="/login" className={navClass}>
                  Log in
                </NavLink>
                <NavLink
                  to="/create-account"
                  className={({ isActive }) => (isActive ? 'button button--small is-active' : 'button button--small')}
                >
                  Create Account
                </NavLink>
              </>
            )}
          </div>

          <button
            type="button"
            className="cart-button"
            data-cart-target
            aria-label={`Cart, ${cart.count} ${cart.count === 1 ? 'item' : 'items'}`}
            onClick={() => cart.setDrawerOpen(true)}
          >
            <BagIcon size={22} />
            {cart.count > 0 && (
              <span key={cart.count} className="cart-button__badge">
                {cart.count}
              </span>
            )}
          </button>

          <button
            type="button"
            className="icon-button nav__menu-toggle"
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>

        {mobileOpen && (
          <div id="mobile-menu" className="mobile-menu glass">
            <ul className="mobile-menu__links">
              <li>
                <NavLink to="/" end className={navClass}>
                  Home
                </NavLink>
              </li>
              <li>
                <NavLink to="/products" end className={navClass}>
                  Products
                </NavLink>
              </li>
              <li>
                <NavLink to="/categories" className={navClass}>
                  Categories
                </NavLink>
              </li>
              <li>
                <NavLink to="/about" className={navClass}>
                  About Us
                </NavLink>
              </li>
              <li>
                <NavLink to="/cart" className={navClass}>
                  Cart{cart.count > 0 ? ` (${cart.count})` : ''}
                </NavLink>
              </li>
            </ul>
            <CategoryLinks />
            <div className="mobile-menu__account">
              {ready && user && (
                <button type="button" className="button button--ghost" onClick={() => void logOut()}>
                  Log out {user.first_name}
                </button>
              )}
              {ready && !user && (
                <>
                  <Link to="/login" className="button button--ghost">
                    Log in
                  </Link>
                  <Link to="/create-account" className="button">
                    Create Account
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
