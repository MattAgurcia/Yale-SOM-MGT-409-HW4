# DESIGN — Campus Customs storefront

Problem 10: what changed in the design, and why it should help customers stick
around and buy. Screenshots are in `app_check_images/` (from the Problem 11 app
check).

**Where it started (Problem 3).** A clean, minimal site in Yale Blue with Yale's
type (EB Garamond and Source Sans 3 as free stand-ins), a nav bar, a product
grid, a product page and a plain chat box. It worked, but it looked like a
template and gave shoppers little help finding or choosing anything.

**The brief.** Keep the Yale palette, move to a glass look with a modern
layout, and make it feel like a real Campus Customs storefront: a cart,
categories, a bulldog helper called Dan, and more motion.

## What changed, and why it helps people buy

| # | What changed | Why it should help customers stay and buy |
|---|---|---|
| 1 | **A glass storefront.** Frosted panels over slow-drifting blurred Yale-blue colour fields, a bento-grid home page with a dark hero ("Bulldog blue, all the way through.") and the featured hoodie floating on a white disc, and a floating header that frosts as you scroll (`home.png`). | It reads as a real, current shop rather than a class project, which earns trust before anyone looks at a price. The glass only frames content; product photos stay on white. |
| 2 | **Cleaned, consistent product photos.** Many catalogue photos were transparent PNGs flattened onto black. The server turns those backgrounds white, trims the dark halo, and every photo sits in the same soft white-to-blue well. Sold-out pieces fade to grey. | The garment is what you see, and 102 photos shot in different ways look like one catalogue. A sold-out piece is obvious at a glance. |
| 3 | **A clear hierarchy.** Every section follows the same steps: a small uppercase label, a serif headline, then plain sans text. Yale Blue is the one action colour; green and orange are kept for stock ("In stock", "Only 3 left", "Almost gone"). | Shoppers scan in seconds. Prices and stock jump out, and colour always means something. |
| 4 | **A Categories menu and page.** A mega menu (and a `/categories` page) by type (hoodies, crewnecks, quarter-zips, tees, jackets) and by the four collections from the brief: residential colleges, varsity sports, graduate and professional schools, and the whole family (plus Yale classics). Each has a count and a cover photo (`categories_menu.png`). Tops / Bottoms / Men / Women wouldn't split anything: every piece is a unisex top. | People shop by identity ("my college", "my team", "for Mom"). They get there in one or two clicks. |
| 5 | **Filters and sort that never dead-end.** Type, collection (opening its colleges, teams, schools or family roles), color, "in stock in my size", a price slider and "hide sold out". Counts update with every choice, options that would give nothing are disabled, and the filters live in the URL (`filters.png`). | Fewer empty pages and faster paths to something they can actually buy in their size. Shared links and Back just work. |
| 6 | **Cards that sell.** Every card shows the photo, name, price, a short description and stock ("In stock: S, M, L, XXL"). Add to cart is on every card in the shop, on the home page, in recommendations and in the chat, with a size picker that crosses out sold-out sizes (`products.png`, `add_to_cart_sizes.png`). | Buying takes two clicks from wherever the shopper is, and they never pick a size that isn't there. |
| 7 | **A product page built to decide.** A large sticky photo beside the details, a size grid with stock in each cell, a quantity stepper, and one button that says exactly what will happen ("Add 2 × M to cart · $136.00"). Below it: "Complete the look", "Similar styles", and, when the chosen size is sold out, in-stock alternatives in that size (`product_detail.png`, `complete_the_look.png`, `sold_out_alternatives.png`). | Size and stock doubts are answered on the spot. A sold-out size becomes a different sale instead of an exit, and outfit pairings grow the basket. |
| 8 | **A size & fit helper.** Height, weight, an optional chest and snug / regular / relaxed give a size with the reasoning, the garment's fit note and live stock in that size (`size_helper.png`). | Size is the biggest reason people hesitate to buy clothes online. One answer removes it, and should cut returns. |
| 9 | **A cart with real feedback.** Adding sends the photo flying into the cart, the cart bounces, its badge pops, the button reads "Added M", and a toast confirms the add. A drawer slides in; the cart page re-checks prices and stock against the live catalogue. Checkout honestly says it's coming soon and to bring the list to 57 Broadway (`fly_to_cart.webp`, `cart_drawer.png`, `cart_page.png`). | Shoppers always know the item went in. No fake checkout, so the shop keeps its promise of straight answers. |
| 10 | **Dan, the bulldog helper.** An animated SVG bulldog in a Yale Blue collar: he blinks, twitches his ears, tilts his head while thinking and pants after answering. Once per visit he pops up with "Woof woof!" and a line for the page ("Want help picking your size?"), plays a short synthesised bark when the chat opens, and offers starter questions ("What hoodies do you have?", "What goes with this?") (`dan_popup.png`, `dan_chat_open.png`). | A friendly face makes help easy to find and fits a shop for the Bulldogs. Starter questions get people asking, and every answer lands on cards they can buy. |
| 11 | **A chat that shows its work.** While Dan works, a live view shows him handing tasks to the Scout and the Stylist along "wires", with sparks and optional pew / thunk sounds. Browse results are laid out on the page as a shelf of full product cards ("Dan fetched these · Hoodies · 27 matches") instead of a list in the chat (`agent_team.webp`, `search_cards.png`). | Waiting feels like progress, not a spinner. Results are the same cards as the shop, one click from the product page or the cart. |
| 12 | **Motion with a job.** Pages fade in, sections rise as you scroll, cards enter one after another and lift on hover. Motion only shows where something went or that work is happening, and all of it stops for shoppers who turn on "reduce motion". | The site feels alive without getting in the way, and stays comfortable for everyone. |
| 13 | **Built for phones.** Two-column grids, a filter drawer, a full-screen chat and tap targets at least 48px tall (`mobile_home.png`, `mobile_filters.png`, `mobile_chat.png`). | Students shop on their phones; nothing important is lost on a small screen. |

## The system behind it

| Token | Value | Used for |
|---|---|---|
| Yale Blue | `#00356b` | Headings, prices, primary buttons, the shopper's chat bubbles |
| Blue 1 / Blue 2 | `#286dc0` / `#63aaff` | Links and labels / focus rings and busy states |
| Ink / Ink 2 | `#1d2533` / `#4a5263` | Body text / secondary text |
| Green / Orange | `#5f712d` / `#bd5319` | In stock / low stock, the cart badge |
| Serif / Sans | Yale's fonts if installed, else EB Garamond / Source Sans 3 | Headings and names / everything else |
| Radii | 30px panels, 22px cards, pill buttons | The soft glass shape |
| Glass | white 72–48%, `blur(22px) saturate(170%)` | Every panel |

All of it lives in `frontend/src/styles.css`. Contrast on white: Yale Blue 12.2:1,
body text 15.4:1, secondary text 7.8:1, so the glass never costs readability.
Stock is always written out ("Sold out", "Only 3 left"), never shown by colour
alone.

## In short

The redesign helps shoppers find (categories, filters, Dan), decide (stock
everywhere, the size helper, outfit pairings) and buy (Add to cart on every
card, a cart that confirms each add), in a store that looks and sounds like
Yale. For the business, sold-out sizes turn into alternatives instead of exits,
and "complete the look" grows the basket.
