import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import CartDrawer from './components/CartDrawer'
import CartToast from './components/CartToast'
import ChatShowcase from './components/ChatShowcase'
import ChatWidget from './components/ChatWidget'
import Footer from './components/Footer'
import NavBar from './components/NavBar'
import AboutPage from './pages/AboutPage'
import CartPage from './pages/CartPage'
import CategoriesPage from './pages/CategoriesPage'
import CreateAccountPage from './pages/CreateAccountPage'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import ProductDetailPage from './pages/ProductDetailPage'
import ProductsPage from './pages/ProductsPage'
import { useReveal } from './useReveal'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/** Slow-drifting blurred colour fields behind the glass panels. Purely decorative. */
function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <span className="backdrop__blob backdrop__blob--1" />
      <span className="backdrop__blob backdrop__blob--2" />
      <span className="backdrop__blob backdrop__blob--3" />
      <span className="backdrop__blob backdrop__blob--4" />
      <span className="backdrop__grid" />
    </div>
  )
}

export default function App() {
  const { pathname } = useLocation()
  useReveal()

  return (
    <>
      <ScrollToTop />
      <Backdrop />
      <NavBar />
      <CartToast />
      <main id="main">
        {/* Products the chat found, shown above whatever page is open. */}
        <ChatShowcase />
        {/* Keyed by path so each page plays its entrance animation. */}
        <div key={pathname} className="page">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/products/:productId" element={<ProductDetailPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/create-account" element={<CreateAccountPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
      </main>
      <Footer />
      <CartDrawer />
      {/* Lives outside <Routes> so the conversation survives page changes. */}
      <ChatWidget />
    </>
  )
}
