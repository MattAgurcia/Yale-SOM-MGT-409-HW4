import { Link } from 'react-router'
import { useChat } from '../chat/chatContext'
import DanAvatar from './DanAvatar'

const YEAR = new Date().getFullYear()

export default function Footer() {
  const { setOpen: openChat } = useChat()

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__inner glass glass--dark">
          <div className="site-footer__brand">
            <Link to="/" className="wordmark wordmark--light">
              <span className="wordmark__mark" aria-hidden="true">
                Y
              </span>
              <span className="wordmark__text">
                <span className="wordmark__name">Campus Customs</span>
                <span className="wordmark__tag">Yale apparel · New Haven</span>
              </span>
            </Link>
            <p>Officially licensed Yale apparel, a short walk from campus.</p>
            <address className="site-footer__address">
              57 Broadway
              <br />
              New Haven, CT 06511
            </address>
          </div>

          <nav aria-label="Shop">
            <p className="site-footer__heading">Shop</p>
            <ul className="site-footer__links">
              <li>
                <Link to="/products">Shop all</Link>
              </li>
              <li>
                <Link to="/categories">Categories</Link>
              </li>
              <li>
                <Link to="/products?type=hoodies">Hoodies</Link>
              </li>
              <li>
                <Link to="/products?collection=colleges">Residential colleges</Link>
              </li>
              <li>
                <Link to="/cart">Your cart</Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Account">
            <p className="site-footer__heading">Campus Customs</p>
            <ul className="site-footer__links">
              <li>
                <Link to="/about">About Us</Link>
              </li>
              <li>
                <Link to="/login">Log in</Link>
              </li>
              <li>
                <Link to="/create-account">Create Account</Link>
              </li>
            </ul>
          </nav>

          <div className="site-footer__dan">
            <DanAvatar size={64} />
            <div>
              <p className="site-footer__heading">Questions? Ask Dan.</p>
              <p>Our bulldog knows every shelf: sizes, stock and what goes with what.</p>
              <button type="button" className="button button--light button--small" onClick={() => openChat(true)}>
                Chat with Dan
              </button>
            </div>
          </div>
        </div>
        <p className="site-footer__legal">
          © {YEAR} Campus Customs · An officially licensed retailer, independent of Yale University.
        </p>
      </div>
    </footer>
  )
}
