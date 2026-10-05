import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { usePageTitle } from '../api'

const VALUES = [
  {
    title: 'Pride for everyone',
    text: 'First-years, faculty, alumni and grandparents all belong in Yale blue. We stock for every one of them.',
  },
  {
    title: 'Pieces that last',
    text: "Classic designs on comfortable, sturdy blanks: the kind of sweatshirt that's still in rotation ten winters later.",
  },
  {
    title: 'Straight answers',
    text: "If a size is sold out or a color isn't offered, we'll say so plainly. No guesswork, no surprises.",
  },
]

export default function AboutPage() {
  usePageTitle('About Us')

  return (
    <>
      <section className="section container">
        <header className="page-head page-head--wide reveal">
          <p className="eyebrow">About us</p>
          <h1 className="display display--ink">A neighborhood shop for the whole Yale family.</h1>
          <p className="lead">
            Campus Customs runs Yale Bulldog Blue, an officially licensed Yale apparel shop at 57 Broadway in New Haven.
            We keep the shelves full of the crewnecks, hoodies and tees people actually live in, from move-in day to
            reunion weekend.
          </p>
        </header>
      </section>

      <section className="section container">
        <div className="split glass reveal">
          <div>
            <p className="eyebrow">What we carry</p>
            <h2>Gear for every corner of the university.</h2>
          </div>
          <div className="prose">
            <p>
              Our racks cover the residential colleges, the varsity teams, the graduate and professional schools, and
              the people cheering them on: moms, dads, grandparents, siblings and the occasional very proud uncle.
            </p>
            <p>
              The classics are all here too. Big block letters, vintage bulldogs, left-chest team marks, and a shirt or
              two for The Game. Every piece on this site shows its price and its stock by size, so you know what's on
              the shelf before you walk in.
            </p>
            <Link to="/products" className="text-link">
              Browse the lineup →
            </Link>
          </div>
        </div>
      </section>

      <section className="section container">
        <div className="section-head reveal">
          <div>
            <p className="eyebrow">What we care about</p>
            <h2>Three things we don't compromise on.</h2>
          </div>
        </div>
        <ol className="pillars pillars--three">
          {VALUES.map((value, index) => (
            <li key={value.title} className="pillar glass reveal" style={{ '--i': index } as CSSProperties}>
              <span className="pillar__num">{String(index + 1).padStart(2, '0')}</span>
              <h3>{value.title}</h3>
              <p>{value.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section container" id="visit">
        <div className="visit glass glass--dark reveal">
          <span className="orb orb--3" aria-hidden="true" />
          <div>
            <p className="eyebrow">Visit the shop</p>
            <h2>Stop by and say hi.</h2>
          </div>
          <div>
            <address className="visit__address">
              57 Broadway
              <br />
              New Haven, CT 06511
            </address>
            <p>
              We're right on Broadway, a quick walk from campus. Come in to try a size, ask a question, or just browse.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
