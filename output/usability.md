# Usability improvements: Campus Customs

Problem 9 asks for two front-end improvements (the site looks better and is
easier to use) and two agent/backend improvements (the agent is better, more
accurate, safer, faster or cheaper). For each one this file covers:

- what was added
- why it helps a Campus Customs shopper or the business
- where to see it in the running app

All four are live in the app. At the time, 86 backend tests covered each one
without calling a real model. The tests stay in the development folder and are
not included in this repository.

| # | Improvement | Type | Where to see it |
|---|---|---|---|
| 1 | "Not in your size? Try these": similar items when something is sold out or not carried | Front end | A product page: tap a sold-out size. Or ask the chat "Is this in XS?" on the Baseball Left Chest Crewneck. |
| 2 | "Complete the look": styled outfit pairings | Front end | Any product page: the "Wear it with" row. Or ask the chat "What would go well with this?" |
| 3 | A boss agent with a team of cheaper sub-agents, shown live in the chat | Agent / backend | Ask the chat anything: the team view appears while it works, with sound, and "Behind the scenes" under each reply. |
| 4 | Account memory and cache-friendly conversations | Agent / backend | Log in and chat: "I remember: Size XS…" appears in the chat, and the agent uses it next time. |

---

## Front end

### 1. "Not in your size? Try these": similar items when something is sold out or doesn't exist

**What we added**

- **Product page: sizes are now buttons.** Tapping one picks that size:
  - If it's sold out, an orange "Not in your size" callout appears with
    similar styles that are **in stock in that size**, e.g. "Sold out in XS.
    These similar styles are in stock in XS."
  - If it's in stock, a "Similar styles" row ("If you like this one") shows
    close alternatives.
  - Every card says why it's suggested, e.g. "Also a crewneck: in navy, in
    stock in XS."
- **Chat: sold out.** When `check_stock` finds the asked-for size sold out,
  it now also returns `similar_in_size`: up to three close alternatives in
  stock in that size. The Concierge shows them as an orange **"In stock in XS
  instead"** group of cards under its reply, each with its reason.
- **Chat: not carried.** For "do you have pink hoodies?" the Scout reports
  that "pink" matches nothing. The Concierge says plainly that the shop
  doesn't carry pink, then shows the closest real options (a shelf of hoodies
  in the colours the shop does carry, or a "Closest we have" group).
- **How "similar" is decided** (the "Recommendations" section of
  `backend/tools.py`, no model call). Every product is read for four traits
  from its catalogue data:
  - the garment's own colour family, from the start of its description (so a
    heather gray sweatshirt with a navy print counts as gray)
  - its layer: tee / mid-layer / jacket
  - how loud its graphic is: big front graphic vs. small left-chest logo
  - its theme: college, sport, school or family role

  A similar item is the same kind of garment first, then the same colour,
  graphic style and theme, within $10, and always in stock (in the chosen size
  when one is picked).

**Why it helps**

- **Shoppers:** a sold-out size used to be a dead end. Now the next-best
  option, actually available in their size, is one tap away, with a reason
  they can trust.
- **The business:** it rescues sales that would otherwise be lost to "sold
  out". It never suggests something that's also sold out, so it doesn't
  frustrate the shopper twice. In the chat, every suggested card must come
  from a recommender in that same turn; the server checks this, so the agent
  can't invent "alternatives".

**See it:**

- Open **Baseball Left Chest Crewneck** and tap **XS**. It's sold out, so the
  callout shows four navy crewnecks in stock in XS.
- Or on that page, ask the chat "Is this in stock in XS?"

### 2. "Complete the look": styled outfit suggestions

**What we added**

- **Product page: a "Complete the look · Wear it with" row.** Up to three
  pieces that layer with the item, each labelled with its role ("Wear under",
  "Layer over", "Top it with") and a one-line styling reason. After you pick a
  size, it only shows pieces in stock in that size.
- **Chat: a Stylist agent.** Asked "what goes with this?" or "how should I
  wear it?", the Concierge sends the Stylist (a cheaper model, see #3). The
  Stylist picks from the recommender's candidates and writes the reason in
  plain words. The picks appear as a **"Complete the look"** group of cards
  under the reply.
- **Real styling rules, not just "other products"** (`tools.complete_the_look`):
  - **Layers.** A hoodie gets a tee to wear under it and a jacket or full-zip
    to layer over; a tee gets a mid-layer and a jacket.
  - **Colour harmony.** Scored pairings using the shop's palette: navy with
    heather gray (the classic Yale pairing), navy with white or cream,
    charcoal with white. Tonal pairings rank lower. Clashing or unknown
    colours are never suggested.
  - **Graphic balance.** A big front graphic is paired with small left-chest
    logos, not with another loud graphic.
  - **Matching affiliation.** A matching college, team or family role is
    preferred ("Morse quarter-zip + Morse tee", "Yale Dad hoodie + Yale Dad
    tee"). Two different colleges or teams in one outfit are never suggested;
    a test in the development folder checks every product in the catalogue.
  - **Honest about range.** The shop only sells tops: tees, crewnecks,
    hoodies, quarter-zips and jackets. So "complete the look" layers tops; the
    agent is told to say so if someone asks for sweatpants, rather than invent
    them.

**Why it helps**

- **Shoppers:** quick, believable styling help: what to wear under it, what
  to throw over it, in colours that go together, in their size.
- **The business:** a natural, non-pushy way to grow the basket from one item
  to an outfit. The rules keep suggestions on-brand. No "pink polyester with
  gray cotton": the shop has no pink, coral is only ever paired with
  neutrals, and colours unknown from the data are left out.

**See it:**

- Open **Champion Reverse Weave Hoodie 1** (navy, big arched YALE). "Wear it
  with" suggests heather gray pieces: two fleece jackets with small chest
  logos ("its small logo lets your hoodie's big graphic lead") and a heather
  gray tee to wear under it.
- Open **Yale Dad Hoodie**: the matching **Yale Dad T Shirt** is offered to
  wear under it.
- In the chat, on the Baseball crewneck, ask "What would go well with it?".
  The Stylist suggests the matching heather gray Baseball tee ("Heather gray
  under navy creates the classic pairing, while matching Baseball makes the
  set feel intentional") and a charcoal zip hoodie to layer over.

---

## Agent / backend

### 3. A boss agent with a team of cheaper sub-agents, shown live in the chat

**What we added**

- **A team of PydanticAI agents** (`backend/agent.py`), each with its own
  instructions, one top-level section per agent in `backend/prompts/prompt.md`:

  | Agent | Model | Job |
  |---|---|---|
  | **Concierge** (the boss) | gpt-5.6-terra | Talks to the shopper and writes the reply. Checks price and stock itself with instant database tools. Delegates the rest. |
  | **Scout** | gpt-5.6-luna (cheaper) | Browsing searches ("what hoodies do you have?", "gifts for dad"). It reads the long result lists so the expensive model doesn't have to, and hands back a short report. |
  | **Stylist** | gpt-5.6-luna | Outfit pairings and close alternatives, picked from the recommender's candidates (#1, #2). |
  | **Memory clerk** | gpt-5.6-luna | After a logged-in reply, updates the customer's memory notes in the background (#4). |

- **The Concierge delegates with tools** (`ask_scout`, `ask_stylist`), and
  can run teammates and its own lookups **at the same time**. Asked "Is this
  in XS, and what goes with it?", it checked stock while the Stylist worked.
- **Built to be cheap and quick:**
  - **No tool round trip for teammates.** The backend runs each teammate's
    database lookup first (instant) and puts the results in its prompt, so
    the teammate needs one model call, not two.
  - **No model call when there's nothing to judge.** When a search is clean
    (every word matched) or finds nothing at all, the Scout answers straight
    from the database. Its model is only used for fuzzy requests ("pink
    hoodies", "a gift for dad").
  - **Ids never go through the expensive model.** The Scout reports only what
    to drop and three highlights; the server fills the page shelf from the
    search ranking. The expensive model never writes out 27 product ids.
- **Same safety checks across the team.** Teammates share the Concierge's
  ledger of prices, stock counts, search hits and recommendations, so the
  reply check from Problem 6 now also covers their work. Each teammate has its
  own output check too: the Scout can only highlight products it actually
  found, and the Stylist can only pick the recommender's candidates. A
  teammate that fails degrades the answer instead of breaking it.
- **Live in the chat.** A new streaming route, `POST /api/chat/stream`
  (server-sent events), pushes every step as it happens. While the reply is
  being built, the chat shows the team:
  - The Concierge on top, the Scout and Stylist on "wires" below, each card
    showing its model tier (Terra / Luna) and its state ("Thinking", "On it",
    "Done").
  - A **spark travels down a wire** when the Concierge hands off a task, and
    **back up** when the report returns.
  - A running log: "Concierge → Scout: Find gift ideas for dad", "Scout
    searched 'gift ideas for dad': 3 matches"…
- **Sounds**, synthesised in the browser in the style of the lecture 10
  council (`frontend/src/chat/teamSound.ts`):
  - **pew** on a hand-off
  - **thunk** when a report lands (softer for an instant one)
  - **tick** for each database lookup
  - **chime** when the answer is ready

  A **Sound on / Sound off** button in the chat header remembers your choice.
- **"Behind the scenes" under every reply.** It shows who worked on it, how
  long it took, every step, and model calls and tokens per tier, e.g. "Luna:
  1 model call · 1,295 tokens in · 199 out; Terra: 2 model calls · 9,440
  tokens in (3,871 from cache) · 181 out".

**Why it helps**

- **The business: cheaper.**
  - The token-heavy jobs (reading 27 search results, weighing outfit
    candidates) moved to the cheaper tier.
  - Plain lookups don't call a model at all.
  - The expensive model writes about 30% fewer output tokens (see
    Measurements).
- **Shoppers: faster where it counts.** Plain browsing ("what hoodies do you
  have?") got about 15–25% faster, because the expensive model no longer
  writes out every product id.
- **Shoppers: better answers.** A focused Stylist with fashion rules gives
  better styling advice than a generalist prompt. The "not carried" case now
  comes with real alternatives instead of a bare "no".
- **Both: easier to trust.** The live view shows the work happening instead
  of a spinner, and the summary shows exactly what each answer cost.

**See it:** open the chat and ask "Any gift ideas for my dad?".

- **While it works:** the Scout lights up "On it", with the hand-off and
  search in the log (and pew / thunk if sound is on).
- **When it's done:** a "Gifts for Dad · 3 matches" shelf goes up, and
  "Behind the scenes · Concierge + Scout" appears under the reply.

### 4. Account memory and cache-friendly conversations

**What we added**

- **Memory notes per customer.** After each logged-in reply, the memory clerk
  (cheap model, in the background, never on the shopper's wait) updates short
  notes in a new `customer_memory` table:
  - sizes
  - likes (colours, colleges, teams)
  - things to avoid
  - who they're shopping for
  - items they looked at
  - a one-line note

  The rules forbid recording prices, stock, payment details, addresses or
  anything sensitive.
- **Visible and in the shopper's control.** The chat shows **"I remember:
  Size XS · Likes navy · Shopping for Dad"** with a **Forget** button.
  "Clear" (all history) wipes the memory too. Guests have no memory.
- **The agent uses it quietly.** It passes a remembered size to `check_stock`
  / the Stylist, leans toward colours the customer likes, and picks up a
  thread ("Still looking for something for your dad?"). What they say now
  always wins.
- **A cache-friendly request layout.** OpenAI-style providers cache the
  unchanging start of a request (the prompt prefix) and bill it at a reduced
  rate. Before, the page context sat inside the system prompt, so it changed
  on every page and broke the cache for everything after it. Now each request
  is ordered from most stable to least:
  1. The static prompt and tools.
  2. The customer's identity (stable for the account).
  3. Their conversation window. It only grows until it reaches 16 messages,
     then jumps forward to keep the last 6. Older messages are already in the
     memory notes. Between jumps the prefix is identical, so the provider
     serves the whole earlier conversation from cache.
  4. The memory notes, page context and the new message, last.
- **A cache lane per account.** Each customer's requests carry their own
  `prompt_cache_key` (a hash, never the email). The provider keeps that
  customer's conversation warm in its cache; guests share one lane.

**Why it helps**

- **Shoppers:** the shop remembers them. Come back next week and it already
  knows their size and that they were shopping for Dad. The memory is shown,
  not hidden, and one click forgets it.
- **The business: cheaper conversations.** On the logged-in benchmark, the
  share of the expensive model's input served from cache went from **30% to
  90%**, and its uncached input fell **84%** (31.7k → 5.0k tokens). The
  history sent per message is also capped by the window, so a long-time
  customer's 200-message history doesn't make every reply more expensive.
- **Why not literally replay old answers instead of asking the model again?**
  A stored answer goes stale: stock changes, and follow-ups like "what about
  in XL?" depend on context. Replaying would break the Problem 6 rule that
  every price and count is fresh from the database. Caching the conversation
  prefix gives most of the savings with none of that risk. (Portkey's gateway
  does still answer a byte-for-byte repeated request instantly from its own
  cache.)

**See it:**

1. Log in, then on a product page ask "Is this in stock in XS?".
2. After a few seconds, **"I remember: Size XS"** appears near the top of the
   chat. Its notes are in the `customer_memory` table.
3. Ask a follow-up like "What else would you suggest?". The XS gets used.
4. Press **Forget** and the line disappears.

---

## Measurements

The same 12-question script was run before and after, against a throwaway
copy of the database with the real models: 6 guest questions, then a 6-turn
logged-in conversation across product pages. The measurements were taken
with a benchmark script in the development folder, which saved each run as a
JSON file. The script and its results are not included in this repository.
Every request tells Portkey to skip its identical-request cache, so repeats
aren't free; the provider's own prompt cache works as it would in normal use.

| | Before: one agent | After: team + cache layout | Change |
|---|---|---|---|
| **Guest, 6 questions** | | | |
| Total time | 33.0 s | 34.5 s | about the same (+5%) |
| Expensive model (Terra): uncached input | 24,335 tokens | 2,861 | **−88%** |
| Terra: share of input from cache | 58% | 95% | |
| Terra: output tokens | 1,255 | 864 | −31% |
| Cheaper model (Luna) | none | 2 calls · 3,494 in · 409 out | |
| **Logged in, 6 turns** | | | |
| Total time | 27.0 s | 30.8 s | +14% |
| Terra: uncached input | 31,746 tokens | 4,957 | **−84%** |
| Terra: share of input from cache | 30% | 90% | |
| Terra: output tokens | 852 | 668 | −22% |
| Background memory updates (Luna, off the wait path) | none | 6 calls · 3,936 in · 901 out | |

Per question:

- **"What hoodies do you have?"** 7.5 s → 5.6 s.
- **"Any tees under $40?"** 5.2 s → 4.4 s.
- **"What quarter-zips do you have?"** 5.1 s → 4.3 s.
- **"Do you have pink hoodies?"** 3.5 s → 7.5 s. It now does more work and
  returns a shelf of the closest real options instead of just "no".

**Reading it honestly:**

- **Much cheaper.** The expensive model's fresh input fell by more than 80%
  and its output by 20–30%. A little cheap-model use was added.
- **About the same speed overall.** Single runs vary by 1–2 s per question.
  Plain browsing got clearly faster; fuzzy requests that now get
  alternatives got slower.
- **The design needed three tries to get here:**
  - **v1:** slower (47.7 s guest), because the Scout needed two model calls
    and product ids were written twice.
  - **v2:** pre-fetching the search and passing ids by reference brought it
    to 39.4 s.
  - **v3, and the final run:** the Scout's instant path brought it to parity.
    The final run also fixed a zero-match case where the Scout looped
    (15.7 s → 5.0 s).

---

## Other ideas from Problem 9, and what became of them

These were suggested alongside the four improvements above. Several were built
in later problems:

| Idea | Status |
|---|---|
| **Filters and sort on the Products page**: type, colour, price, "in stock in my size" | Built in Problem 10 (`harness.md` §8.5) |
| **A size and fit helper**: a size chart in the database plus a `size_advice` tool | Built in Problem 10 (`harness.md` §8.3) |
| **A cart**, with Add to cart on every card | Built in Problem 10. Online checkout isn't open; the cart page points shoppers to 57 Broadway |
| **A search box** for shoppers who'd rather type than chat | Built in Problem 10, on the Products page (it filters as you type) |
| **A per-shopper chat rate limit**, to cap model spend | Built in Problem 12 (`harness.md` §12.2) |
| **"Notify me when it's back"** for a sold-out size | Not built |
| **Saved items (a wishlist)**, which Dan could mention | Not built |
