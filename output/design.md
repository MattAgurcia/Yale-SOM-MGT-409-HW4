# DESIGN — Campus Customs storefront

Problem 10: what changed in the design, and why it should help customers stick
around and buy. Screenshots are in `app_check_images/`.

**Before:** a clean, minimal Problem 3 site in Yale Blue. It worked, but it
looked like a template. **The brief:** keep the Yale palette, go glass and
modern, and make it feel like a real Campus Customs storefront with a bulldog
helper and more motion.

| What changed | Why it helps customers stay and buy |
|---|---|
| **A glass storefront.** Frosted panels over slow-drifting Yale-blue colour fields, a bento home page with a dark hero ("Bulldog blue, all the way through.") and the featured hoodie floating on a white disc (`home.png`). | It looks like a real shop, which earns trust before anyone sees a price. The glass frames the content; the products stay the focus. |
| **Clear hierarchy, honest colour.** Every section runs small label → serif headline → sans text, in Yale's type (or free stand-ins). Yale Blue is the only action colour; green and orange mean stock ("In stock", "Only 3 left"). | Shoppers scan in seconds. Prices and stock jump out, and colour always means something. |
| **Product presentation.** Photos that came flattened onto black are cleaned to white and set in matching soft wells. Every card shows the photo, name, price, a short description, stock by size and Add to cart (`products.png`). | 102 photos look like one catalogue, and a shopper can judge and buy a piece without leaving the grid. |
| **Dan, the bulldog.** An animated SVG mascot: he blinks, tilts his head while thinking and pants after answering. He pops up once per visit with "Woof woof!" and a line for the page, gives a short bark when the chat opens, and offers starter questions (`dan_popup.png`). | A friendly face makes help easy to find and fits a shop for the Bulldogs. Starter questions get people asking. |
| **A chat that shows its work.** A live view shows Dan handing tasks to his Scout and Stylist, with sparks and optional "pew" sounds. Results land on the page as a shelf of full product cards, not a list in the chat (`agent_team.webp`, `search_cards.png`). | Waiting feels like progress, and every answer is one click from a product page or the cart. |
| **Motion with a job.** Pages fade in, sections rise as you scroll, cards lift on hover, and an added item flies into the cart. All of it stops under "reduce motion" (`fly_to_cart.webp`). | The site feels alive, and every add is confirmed, without getting in the way. |
| **Built for phones.** Two-column grids, a filter drawer, a full-screen chat and tap targets at least 48px tall (`mobile_home.png`). | Students shop on their phones. |

**The palette** (`frontend/src/styles.css`): Yale Blue `#00356b`, blue
`#286dc0` and `#63aaff`, ink `#1d2533`, green `#5f712d`, orange `#bd5319`.
Body text on white is 7.8:1 or better, and links, prices and stock labels
clear the 4.5:1 accessibility minimum, so the glass never costs readability.

**The features this design frames** are written up in `usability.md` and
`harness.md` §8:

- the Categories menu, filters and sort
- the size helper
- the cart
- "complete the look" and similar styles

**In short:** the redesign makes Campus Customs look and sound like Yale, and
puts help (Dan), proof (stock everywhere) and the next step (Add to cart) on
every screen.
