import { Link } from 'react-router'
import { usePageTitle } from '../api'

export default function NotFoundPage() {
  usePageTitle('Page not found')

  return (
    <section className="section container">
      <header className="page-head">
        <p className="eyebrow">404</p>
        <h1>We couldn't find that page.</h1>
        <p className="lead">It may have moved, or the link might be off by a letter.</p>
        <div className="button-row">
          <Link to="/products" className="button">
            Shop the lineup
          </Link>
          <Link to="/" className="button button--ghost">
            Back home
          </Link>
        </div>
      </header>
    </section>
  )
}
