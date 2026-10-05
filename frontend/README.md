# Campus Customs: front end

React + Vite + TypeScript. This note covers the front end only. For the full
setup (the data pack in `data/`, the `.env` file, the Python virtualenv and
the backend) see [`../README.md`](../README.md).

## How it talks to the backend

The front end only uses relative URLs (`/api/...`, `/media/...`). In
development, Vite's proxy forwards both to the FastAPI backend at
`http://127.0.0.1:8000` (`vite.config.ts`). The browser sees one origin, so
there is no CORS setup and the login cookie is sent with every request.

Start the backend first, from `../backend` with the virtualenv active:

```bash
uvicorn main:app --reload --port 8000
```

## Commands

Run these from this folder (`frontend/`):

| Command | What it does |
|---|---|
| `npm install` | Installs the packages into `node_modules/` (first time only). |
| `npm run dev` | Starts the dev server on http://localhost:5173. If 5173 is busy, Vite picks the next free port and prints it. |
| `npm run build` | Type-checks (`tsc -b`), then builds the site into `dist/`. |
| `npm run lint` | Runs oxlint over the source. |
| `npm run preview` | Serves the built `dist/` locally, with the same proxy. |

Developed with Node 26.9.0 and npm 11.19.1 (Vite 8, React 19, TypeScript 6.0).

## Pages

| Route | Page |
|---|---|
| `/` | Home |
| `/products` | The shop: filters (type, collection, colour, size in stock, price) and sort, kept in the URL |
| `/products/:productId` | Single product: image, description, price, stock by size, Add to cart, Find my size |
| `/categories` | Shop by type, collections (colleges, sports, schools, family, classics) and colour |
| `/cart` | The cart (saved in this browser; checkout coming soon) |
| `/about` | About Us |
| `/login`, `/create-account` | Log in / create an account (session cookie set by `backend/main.py`, section "Accounts, login and sessions") |

## The chat

The chat is Dan, the Campus Customs bulldog (`src/components/DanAvatar.tsx`,
`DanLauncher.tsx`). His panel (bottom right) streams each message through
`POST /api/chat/stream` (`streamChatMessage` in `src/api.ts`). While the agent
team works, it shows them live (`src/components/TeamActivity.tsx`, with
synthesised sounds from `src/chat/teamSound.ts`). It then renders the reply
with product cards, suggestion groups and a "Behind the scenes" summary.

- Product pages show "Complete the look" and similar-style picks
  (`src/components/Recommendations.tsx`).
- When the shopper browses a kind of item ("what hoodies do you have?"), the
  reply also carries a `showcase`. `ChatShowcase` lays it out at the top of
  the page as `ProductCard`s that open each product's page (state shared
  through `src/chat/`).
- Each message also carries `page` context: the product being viewed, or the
  shelf on screen.
- For a logged-in shopper the backend saves the chat in `chat_messages`. The
  panel reloads it from `GET /api/chat/history` on login and empties when the
  shopper logs out.
