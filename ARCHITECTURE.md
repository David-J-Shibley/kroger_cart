# Kroger Shopping Cart — Technical Overview

This document describes how the app was built, the main technical decisions, and details that matter for a technical audience (developers, DevOps, or reviewers).

---

## What the app does

- **Meal plan + grocery list:** A local LLM (Ollama) generates a 7-day meal plan for a family of three and a single consolidated grocery list. The list is parsed from the LLM output and each line gets an “Add to cart” action.
- **Kroger integration:** Users sign in with Kroger (OAuth 2.0), search products by name, and add items to their Kroger cart. When a search returns multiple products, a modal lets them pick one; they can sort by price and view full product metadata (JSON).
- **Persistence:** Login is persisted across reloads using a refresh token; the access token is refreshed when expired so users don’t have to sign in again until the refresh token expires.

---

## Tech stack

| Layer        | Choice                    | Notes                                      |
|-------------|----------------------------|--------------------------------------------|
| Server      | Node.js + Express          | TypeScript, run with `tsx` (no separate compile step). |
| Client      | Vanilla TS → JS            | Single bundle `dist/kroger-cart.js`, no framework.     |
| Styling     | Plain CSS                  | One file `kroger-cart.css`, CSS variables for theme.  |
| LLM         | Ollama                     | Local inference; streaming `/api/chat`.               |
| APIs        | Kroger Products + Cart API | Products (search), Cart (add), OAuth for user context.|
| Deployment  | Docker + Docker Compose    | Optional: run app + Ollama in containers.             |

---

## Repository layout

```
krogerCart/
├── server.ts              # Express server: static files, Ollama proxy, Kroger proxy + OAuth
├── kroger-cart.html       # Single-page UI
├── kroger-cart.css        # Styles (Kroger-inspired theme)
├── kroger-cart.ts         # Client logic (TypeScript)
├── tsconfig.client.json   # TS config for client bundle only
├── dist/
│   └── kroger-cart.js     # Built client (npm run build:client)
├── kroger-oauth-callback.html   # OAuth redirect target; exchanges code for tokens
├── package.json
├── Dockerfile             # Build app image
├── docker-compose.yml     # App + Ollama services
├── DOCKER.md              # Docker runbook
└── ARCHITECTURE.md        # This file
```

The server serves the directory as static files and mounts two proxy “prefixes”: `/ollama-api` and `/kroger-api`. The client talks only to the same origin; the server forwards to Ollama and Kroger.

---

## Architecture and data flow

### High level

1. **Browser** loads `kroger-cart.html`, which loads `kroger-cart.css` and `dist/kroger-cart.js`.
2. **LLM path:** Client POSTs to `/ollama-api/api/chat` (streaming). Server proxies to `OLLAMA_ORIGIN` (e.g. `http://ollama:11434` in Docker). Response is streamed back; client parses SSE-like newline-delimited JSON and renders the meal plan + parses out grocery lines.
3. **Kroger path:**  
   - **Product search:** Client uses an **app access token** (client credentials) to call the server’s Kroger proxy (`/kroger-api/v1/products?...`). Server forwards to Kroger with that token.  
   - **Cart add:** Client uses a **user access token** (OAuth) and sends requests to the proxy (`/kroger-api/v1/cart/add`). Server forwards with the user’s Bearer token.  
   - **OAuth:** User is sent to Kroger, then back to `kroger-oauth-callback.html`, which POSTs the code to `/kroger-api/oauth-exchange`. Server exchanges code for tokens and stores them in the browser (localStorage). Refresh is done via `/kroger-api/oauth-refresh` when the access token is expired.

### Why a server at all

- **CORS:** Kroger and (in many setups) Ollama are on different origins; the browser can’t call them directly from the page. The server proxies so the browser only talks to the same origin.
- **Secrets:** Client credentials (client ID/secret) are in the client bundle today; for production you’d move token issuance (and possibly refresh) to the server and never ship the secret. The proxy also keeps a single place to add auth or rate limiting later.
- **Streaming:** The server streams the Ollama response so the client can show text as it’s generated instead of waiting for the full body.

---

## Technical decisions

### 1. No front-end framework

The UI is one HTML file, one CSS file, and one JS bundle. Buttons use `onclick` handlers that call global functions attached to `window`. This keeps the app small, build simple (`tsc` for the client only), and avoids a heavy runtime. Tradeoff: no reactive bindings or component model; state is in module-level variables and DOM.

### 2. Client in TypeScript, server in TypeScript

- **Server:** Run with `tsx` so we don’t compile to JS; `server.ts` is executed directly.  
- **Client:** Compiled with `tsc -p tsconfig.client.json` to `dist/kroger-cart.js` (ES2020, DOM lib). Types (e.g. `KrogerProduct`, `KrogerCartResponse`) live in the client TS and improve maintainability; the compiled JS is loaded by the HTML.

### 3. Two Kroger tokens

- **App token (client credentials):** Used for **product search** only. Obtained (and cached) by the client via the server’s `/kroger-api/token` or directly from Kroger’s token endpoint. No user context.  
- **User token (OAuth authorization code):** Used for **cart** only. Obtained after the user signs in; stored in localStorage with expiry. Cart add requests send this token through the proxy.  
This matches Kroger’s model: product search is app-level; cart is user-level.

### 4. Token refresh for persistent login

Kroger access tokens are short-lived. We store the **refresh token** and, when the access token is expired, call `/kroger-api/oauth-refresh` (server calls Kroger with `grant_type=refresh_token`). The client then uses the new access token and updates localStorage. So login survives page reloads until the refresh token expires. The client exposes `getKrogerUserTokenOrRefresh()` and uses it for any cart/API call that needs the user token.

### 5. Proxy for Ollama and Kroger

All Ollama and Kroger requests go to the same origin and are forwarded by the server. The client only needs the server’s base URL (and, when applicable, `OLLAMA_ORIGIN` is a server-side env var for where to proxy Ollama). This simplifies the client and keeps CORS and timeouts on the server.

### 6. Streaming Ollama response

The server does not buffer the Ollama response. It reads `proxyRes.body` with a `for await` loop and writes chunks to the response. The client uses `response.body.getReader()` and parses newline-delimited JSON for each chunk. So the user sees the meal plan and grocery list appear incrementally. Timeouts: server proxy and client request both use a long timeout (e.g. 10 minutes) so that slow model load or long generations don’t abort mid-stream.

### 7. Parsing grocery lines from LLM output

The LLM returns free text (meal plan + “Grocery list:” + items). We don’t rely on strict JSON or markdown. The client:

- Splits on newlines and looks for a “Grocery list:” / “Shopping list:” section.
- Filters out section headers (e.g. “Day 1”, “Meal Plan for …”) so they don’t become grocery lines.
- Strips markdown-style bullets and leading/trailing `*`.
- Uses a fallback: if no section is found, treats lines that “look like” items (e.g. contain “lb”, “oz”, numbers) as the list.

So the prompt asks for a clear “Grocery list:” block and sensible line format; the parser is tolerant of small variations.

### 8. Product name shortening for cart

Kroger cart payloads accept a product “name”. We send a **short** name (e.g. “Frozen broccoli”) instead of the full label (e.g. “Frozen broccoli, 2 lb”) by taking the substring before the first comma. This keeps the cart display cleaner and matches how we often search.

### 9. Product picker when multiple results

Search can return many products. Instead of auto-picking the first, we show a **modal** with all results, sortable by price (default / low-to-high / high-to-low). Each row has “Add to cart” and a “Metadata” button that shows the full Kroger product object as JSON. We store the raw API object (`raw`) on each picker item so Metadata shows everything Kroger returned, not just our normalized `{ upc, productId, name, price }`.

### 10. Cart API response handling

Kroger’s cart add endpoint can return 200 with an **empty body** or non-JSON. The client uses `response.text()` then `text ? JSON.parse(text) : {}` so we never call `response.json()` on an empty body. On success with no body we still update the UI (e.g. show “Your cart is empty” or leave the last state); on error we surface the status or parsed error message.

### 11. Static assets and build

- HTML/CSS are static.  
- Client is the only built artifact: `kroger-cart.ts` → `dist/kroger-cart.js`.  
- The server serves `__dirname` (the project root), so `kroger-cart.html`, `kroger-cart.css`, `dist/kroger-cart.js`, and `kroger-oauth-callback.html` are all served as-is. No bundler, no hashed filenames; cache headers are Express defaults.

### 12. Docker and deployment

- **Single Dockerfile:** Installs deps, copies source, runs `npm run build:client`, then `npm start` (tsx). Server listens on `0.0.0.0` so it’s reachable from outside the container.  
- **docker-compose:** Defines two services, `app` and `ollama`, on a shared network. The app sets `OLLAMA_ORIGIN=http://ollama:11434` so the proxy targets the Ollama container. Models are persisted in a volume for the Ollama service.  
- **Env:** `PORT`, `HOST`, `OLLAMA_ORIGIN`, `OLLAMA_PROXY_TIMEOUT_MS` allow tuning without code changes. See `DOCKER.md` for runbooks.

---

## Security and credentials

- **Kroger:** Client ID and client secret are currently in the client bundle (`kroger-cart.ts`). Redirect URI is set in the client and must match exactly what is configured in Kroger Developer Portal. For a production deployment you would:
  - Move client credentials to the server only.
  - Issue app and user tokens (and refresh) on the server; the client would receive only opaque session cookies or short-lived tokens.
- **OAuth state:** We store a random state in sessionStorage before redirecting to Kroger and check it in the callback to mitigate CSRF.  
- **Tokens in browser:** User and refresh tokens are in localStorage. That’s acceptable for a local or internal tool; for a public app you’d consider httpOnly cookies and CSRF protection.

---

## Configuration and environment

| Variable                   | Where    | Purpose |
|----------------------------|----------|--------|
| `PORT`                     | Server   | Listen port (default 8000). |
| `HOST`                     | Server   | Listen host (default `0.0.0.0`). |
| `OLLAMA_ORIGIN`            | Server   | Base URL for Ollama (e.g. `http://ollama:11434` in Docker). |
| `OLLAMA_PROXY_TIMEOUT_MS`  | Server   | Proxy timeout for Ollama (default 600000 ms). |
| Client constants           | `kroger-cart.ts` | `CLIENT_ID`, `CLIENT_SECRET`, `KROGER_REDIRECT_URI`, `OLLAMA_MODEL`, `KROGER_LOCATION_ID`. Change and rebuild client for different envs. |

For Docker, the redirect URI must match how users reach the app (e.g. `http://localhost:8000/kroger-oauth-callback.html`). If you host on a different domain/port, update the redirect URI in code and in Kroger’s portal.

---

## Kroger APIs used

- **Products:** `GET /v1/products?filter.term=...&filter.limit=...&filter.locationId=...` — search by term; we normalize results to `{ upc, productId, name, price }` and keep `raw` for metadata.  
- **Cart:** `PUT /v1/cart/add` — body is `{ items: [{ quantity, upc, productId, product: { name, price } }] }`. User Bearer token required.  
- **OAuth:** Authorization URL for user sign-in; token endpoint for code exchange and refresh. Scopes include product read and cart write as required by Kroger.

---

## Ollama integration

- **Endpoint:** `POST /api/chat` with a JSON body (model, messages, stream, options). We use `stream: true` and `num_predict: 2048`.  
- **Model:** Default is `qwen3:8b`; override by changing `OLLAMA_MODEL` in the client and rebuilding.  
- **Prompt:** A single system-style prompt that asks for a 7-day meal plan and one consolidated grocery list with clear rules (units, “Grocery list:” header, one line per ingredient). The client then parses that text into a list of add-to-cart lines.

---

## Error handling and UX

- **502 from proxy:** If the server can’t reach Ollama (or the request times out), it returns 502 with a JSON `{ error: "..." }` and a short hint (e.g. “Cannot reach Ollama at …”). The client reads this and shows it in the generated area.  
- **LLM errors:** Non-OK responses from the Ollama proxy are read as text; if JSON with an `error` field, that message is shown so the user sees the server’s hint.  
- **“Taking a while” hint:** After ~15 seconds of “Connecting…”, the client adds a line suggesting pulling the model in Docker (`docker exec -it kroger-ollama ollama pull <model>`).  
- **Cart add:** Empty or invalid JSON body from Kroger is handled without throwing; auth errors (e.g. 403, AUTH-1007) trigger an alert suggesting sign-out and sign-in again.

---

## Testing and iteration

- **Local:** Run `npm start`, open `http://localhost:8000/kroger-cart.html`. Run Ollama locally or point `OLLAMA_ORIGIN` at a remote instance.  
- **Docker:** `docker compose up -d`, then `docker exec -it kroger-ollama ollama pull <model>`. Rebuild client after TS/CSS/HTML changes; rebuild app image after server or client changes.  
- **Kroger:** Use Kroger Developer Portal to create an app, set redirect URI, and get credentials. For cart, sign in through the app and add items; verify in the Kroger cart on the web or app.

---

## Summary

The app is a thin, same-origin front end backed by a Node proxy that handles Ollama (streaming) and Kroger (products, cart, OAuth). Technical choices favor simplicity: vanilla TS/HTML/CSS, a single client bundle, and clear separation between app token (search) and user token (cart), with refresh for persistent login. Docker Compose is provided to run the app and Ollama together with minimal configuration.
