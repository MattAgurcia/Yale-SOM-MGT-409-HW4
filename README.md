# Campus Customs — Yale SOM, MGT-409 HW4

Campus Customs is the website for Yale Bulldog Blue, an officially licensed
Yale apparel shop at 57 Broadway, New Haven. Shoppers browse the catalogue,
filter it, find their size, keep a cart, create an account and chat with Dan,
the shop's bulldog concierge. The front end is React + Vite + TypeScript. The
back end is a FastAPI app (`backend/main.py`) whose chat is run by a team of
PydanticAI agents. Every model call goes through the Portkey gateway. Dan
(`gpt-5.6-terra`) talks to the shopper and checks prices, stock and sizes
himself. The Scout (`gpt-5.6-luna`) searches the catalogue. The Stylist
(`gpt-5.6-luna`) picks outfits and alternatives. The memory clerk
(`gpt-5.6-luna`) keeps short notes on logged-in customers. Every price and
stock count Dan states is read live from the database. The agent itself is
four files under `backend/`: `prompts/prompt.md`, `agent.py`, `tools.py` and
`models.py`.

All paths below are relative to the `hw4/` folder, the folder this README is in.

## Repository layout

```
hw4/
├── AI_prompts.md          the prompts typed for each question
├── README.md              this file
├── requirements.txt       Python packages for the back end
├── .env.example           settings template, placeholders only
├── .gitignore             keeps .env, data/, .venv/ and node_modules/ out of git
├── frontend/              the Vite React TypeScript app
│   ├── package.json       scripts: dev, build, lint, preview
│   ├── package-lock.json
│   ├── vite.config.ts     port 5173; forwards /api and /media to the back end
│   ├── index.html
│   ├── public/
│   ├── src/               pages, components, cart, chat, auth, shop filters
│   └── README.md, tsconfig*.json, .oxlintrc.json, .gitignore
├── backend/
│   ├── main.py            the FastAPI app: routes, accounts and sessions, chat safety rules
│   ├── agent.py           the agent team, saved chats and memory notes, the audit trail
│   ├── tools.py           the shop database, categories, recommendations, size helper,
│   │                      and the agents' tools
│   ├── models.py          every request, response and agent type (Pydantic)
│   └── prompts/
│       └── prompt.md      each agent's instructions, one "# " section per agent
└── output/
    ├── harness.md         how the system works
    ├── design.md          what changed in the design, and why it helps people buy
    ├── usability.md       the Problem 9 usability improvements
    ├── app_check.html     the live app check, with screenshots
    ├── app_check_images/  the screenshots app_check.html links to
    └── audit_trail.json   append-only record of agent-loop activity
```

The data pack (`data/`) is not in git. Step 1 says where it goes.

## What you need

- **Python 3.11 or later.** The code uses `datetime.UTC`, added in 3.11. It
  was developed on 3.14.
- **Node.js and npm.** The front end uses Vite 8, which needs Node
  `^20.19.0` or `>=22.12.0`. It was developed on Node 26.9.0 and npm 11.19.1.
- **A Portkey API key** that can reach the OpenAI models `gpt-5.6-terra` and
  `gpt-5.6-luna`. Without one the site still works, but the chat does not.
- **The data pack:** `campus_customs.db` and the `products/` folder of photos.

## 0. Get the code

Clone the repository into a folder called `hw4`:

```bash
git clone https://github.com/MattAgurcia/Yale-SOM-MGT-409-HW4.git hw4
```

```bash
cd hw4
```

## 1. Place the data pack

Put the data pack in `hw4/data/`, so the layout is:

```
hw4/
└── data/
    ├── campus_customs.db
    └── products/
        ├── 2025-yale-vs-harvard-t-shirt.jpg
        ├── baseball-left-chest-crewneck.jpg
        └── ...                102 .jpg files in all
```

The back end looks for exactly these paths. `tools.py` sets `DATA_DIR` to
the `data/` folder next to `backend/`, and `DEFAULT_DB_PATH` to
`data/campus_customs.db` inside it. Each row in the `catalogue` table names
its photo as `products/<file>.jpg`, relative to `data/`. The back end serves
the photos itself at `/media/products/<file>.jpg`, cleaned for a white page,
so they never need copying anywhere else.

`data/` is in `.gitignore`. Never commit the database or the photos.

The database must already hold `catalogue`, `inventory`, `users` and
`chat_messages`. On first start the back end creates any missing tables
(`sessions`, `customer_memory`, `chat_safety`, `size_guide`, `fit_notes`) and
fills the size chart and fit notes.

To check the photos are in place, from `hw4/`:

```bash
ls data/products | wc -l
```

It should print 102.

## 2. Add your Portkey key

From `hw4/`, copy the template:

```bash
cp .env.example .env
```

Open `hw4/.env` and replace the placeholder in `PORTKEY_API_KEY` with your
key. The other settings have working defaults:

| Variable | Default | What it does |
|---|---|---|
| `PORTKEY_API_KEY` | none | The gateway key. Without it the chat answers 503. |
| `PORTKEY_BASE_URL` | `https://api.portkey.ai/v1` | Where model requests go. |
| `PORTKEY_PROVIDER` | `openai` | Sent as the `x-portkey-provider` header. |
| `CAMPUS_CUSTOMS_MODEL` | `gpt-5.6-terra` | Dan's model. |
| `CAMPUS_CUSTOMS_TEAM_MODEL` | `gpt-5.6-luna` | The Scout's, the Stylist's and the memory clerk's model. |
| `COOKIE_SECURE` | `false` | Set to `true` when the site is served over HTTPS. Leave it `false` for local http. |

Two more variables are not in `.env.example`. `CAMPUS_CUSTOMS_DB` points the
app at another database file, and `CAMPUS_CUSTOMS_AUDIT` at another audit trail
file. Leave them unset to use `data/campus_customs.db` and
`output/audit_trail.json`.

`agent.py` calls `load_dotenv(find_dotenv())`. That starts in `backend/` and
walks up, using the first `.env` it finds: `backend/.env`, then `hw4/.env`,
then any folder above. Variables already set in your shell win over the file.
`.env` is in `.gitignore`. Never commit the real one.

## 3. Start the back end

In a first terminal, starting in `hw4/`:

```bash
cd backend
```

The first time only, create the virtualenv at `hw4/.venv`:

```bash
python3 -m venv ../.venv
```

Activate it:

```bash
source ../.venv/bin/activate
```

The first time only, install the packages:

```bash
pip install -r ../requirements.txt
```

Start the server:

```bash
uvicorn main:app --reload --port 8000
```

On startup the server creates any missing tables and starts cleaning the
product photos in the background, which takes a few seconds. To check it is up,
open http://127.0.0.1:8000/api/products (the catalogue as JSON) or
http://127.0.0.1:8000/docs (every route).

Next time, only the `cd`, `source` and `uvicorn` commands are needed.

## 4. Start the front end

In a second terminal, starting in `hw4/`:

```bash
cd frontend
```

The first time only:

```bash
npm install
```

Then:

```bash
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` and `/media` to
`http://127.0.0.1:8000` (`frontend/vite.config.ts`), so the browser sees one
origin and the login cookie rides along. Keep the back end running on port
8000.

## Try it

1. **Browse.** Open Products and filter by type, collection, colour, size in
   stock and price, or sort. Categories groups the shop by type, collection
   and colour. Open a product to see its stock by size, Find my size, and
   similar styles.
2. **Create an account** on the Create account page. Passwords need at least
   8 characters, and well-known passwords are refused. The data pack also
   comes with seed test accounts; their passwords are not in this repository.
3. **Ask Dan "What hoodies do you have?"** Click the bulldog button to open the
   chat. Matching product cards appear in the chat and at the top of the page.
4. **Ask about price and stock**, for example "How much is the Yale Mom
   Crewneck, and is it in stock in a medium?" Dan reads both from the database
   and says plainly when a size is sold out.
5. **On a product page, ask "What goes with this?"** It is one of the starter
   buttons under Dan's greeting. The Stylist picks pieces to wear with it.
6. **Add items to the cart.** The cart is kept in this browser. The shop does
   not take online orders yet, so the cart page tells you to bring the list to
   57 Broadway.
7. **Log in and chat, then come back later.** Dan picks up the saved
   conversation and remembers your sizes and likes. In the chat panel, Clear
   deletes the saved chat and Forget deletes the notes.

## Where things are written

- **`output/audit_trail.json`**: every chat turn, one entry per line: the
  message arriving, any safety rule stepping in, each model call and tool call,
  any retry, and the stop reason. It is append-only. Each write replaces only
  the closing `]`, and nothing in the app truncates or deletes the file, so it
  survives restarts and `--reload`. It is never wiped. The file is in git, so
  chatting locally adds to it. If the file ever ends in something the app did
  not write, new entries go to `output/audit_trail.unappended.jsonl` instead
  (git-ignored).
- **`data/campus_customs.db`**: new accounts, login sessions (the database
  keeps only a hash of each token), logged-in shoppers' saved chats and memory
  notes, and ended chats. `data/` is git-ignored, so none of this reaches git.
- **The browser**: the cart, in local storage. Nothing about the cart is sent
  to the server.

## Troubleshooting

- **The chat says "The shopping assistant isn't available right now."** The
  chat route answered 503 because `PORTKEY_API_KEY` is not set. Put the key in
  `hw4/.env` and restart uvicorn. The rest of the site works without it.
- **uvicorn stops at startup with "No shop database at …/data/campus_customs.db.
  Place the data pack in hw4/data/".** The database isn't where the back end
  looks for it. Do step 1, then start uvicorn again. (The back end never creates
  an empty database in its place.)
- **Product photos are missing or broken.** `data/products/` is not in place
  or is incomplete. The server log shows `FileNotFoundError`. Run the check at
  the end of step 1, then reload the page.
- **Port 5173 is busy.** Vite picks the next free port and prints it. Open the
  address it prints.
- **Port 8000 is busy.** Stop the other process. The front end's proxy expects
  the back end on 8000 (`frontend/vite.config.ts`).
- **A prompt edit makes no difference.** `prompts/prompt.md` is read once, when
  `agent.py` builds the agents, and `--reload` only watches `.py` files.
  Restart uvicorn. Changes to `.env` also need a restart. To reload on prompt
  edits too, start uvicorn like this:

```bash
uvicorn main:app --reload --reload-include '*.md' --port 8000
```

- **Dan stops answering and says the chat has ended.** An abusive message
  ends the chat at once, and 3 off-topic or manipulation messages in a row end
  it too. It reopens after 15 minutes. Separately, a chat session or account
  can send at most 20 messages in any 5 minutes, and a network address at most
  60.
- **`pip install` or the server fails on an older Python.** Python 3.11 or
  later is needed. Check the version before creating the venv:

```bash
python3 --version
```

- **`npm run dev` fails on an older Node.** Vite 8 needs Node `^20.19.0` or
  `>=22.12.0`. Check the version:

```bash
node --version
```

## More documentation

- `output/harness.md`: how the system works. Sections 10 to 14 are the
  reference for the finished system: the model fields in `models.py`, the
  tools and abilities, the safety rules, the audit trail, and the specs (models,
  loop limits, result caps, how to run it).
- `output/design.md`: what the Problem 10 redesign changed, and why each change should help customers stick around and buy.
- `output/usability.md`: the four Problem 9 improvements, why they help, and
  where to see them in the app.
- `output/app_check.html`: the live app check. Open it in a browser; its
  screenshots are in `output/app_check_images/`.
- `AI_prompts.md`: the prompts typed for each question.

The automated backend tests and the chat benchmark script that
`output/harness.md` mentions are kept in the development folder, so that this
repository matches the required layout. `output/harness.md` §15 explains.
