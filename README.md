# Kroger Shopping Cart

Generate a weekly meal plan and grocery list with a local LLM (Ollama), then add items to your **Kroger** cart in one click. Sign in with your Kroger account, pick products when there are multiple matches, and keep your cart in sync—all from a single page.

![Kroger blue theme](https://img.shields.io/badge/Kroger-004BBD?style=flat&logo=kroger)

## Features

- **Meal plan + grocery list** — Ollama generates a 7-day meal plan for a family of three and one consolidated shopping list. Streams output as it’s generated.
- **Add to Kroger cart** — Sign in with Kroger (OAuth), search by product name, and add items. When multiple products match, choose from a modal (sort by price, view full metadata).
- **Persistent login** — Uses Kroger’s refresh token so you stay signed in across reloads.
- **Runs locally or in Docker** — Use Ollama on your machine or run both the app and Ollama in Docker Compose.

## Prerequisites

- **Node.js** 18+ (for local run)
- **Ollama** — [Install](https://ollama.com) and pull a model (e.g. `ollama pull qwen3:8b`)
- **Kroger developer account** — [Create an app](https://developer.kroger.com/) to get Client ID and Client Secret, and add a redirect URI for OAuth

## Quick start (local)

1. **Clone and install**

   ```bash
   git clone https://github.com/David-J-Shibley/kroger_cart
   cd kroger_cart
   npm install
   ```

2. **Build the client**

   ```bash
   npm run build:client
   ```

3. **Add your Kroger credentials**

   Edit `kroger-cart.ts` and set:

   - `CLIENT_ID` — from Kroger Developer Portal  
   - `CLIENT_SECRET` — from Kroger Developer Portal  
   - `KROGER_REDIRECT_URI` — must match exactly what you add in the portal (e.g. `http://localhost:8000/kroger-oauth-callback.html`)

   Rebuild after changing: `npm run build:client`

4. **Start the server**

   ```bash
   npm start
   ```

5. **Open the app**

   Go to **http://localhost:8000/kroger-cart.html**

6. **Sign in with Kroger** (first time only), then generate a meal plan or add products manually.

## Quick start (Docker)

Run the app and Ollama together:

```bash
docker compose up -d
docker exec -it kroger-ollama ollama pull qwen3:8b   # pull the default model
```

Open **http://localhost:8000/kroger-cart.html**.  
You still need to put your Kroger Client ID and Secret in the client (see above) and rebuild the image, or build your own image with credentials baked in for your environment.

For more options (Ollama on host, custom port, 502 troubleshooting), see **[DOCKER.md](DOCKER.md)**.

## Kroger setup

1. Go to [Kroger Developer Portal](https://developer.kroger.com/) and create an application.
2. Under **Redirect URIs**, add the exact URL your app uses for the OAuth callback, e.g.:
   - Local: `http://localhost:8000/kroger-oauth-callback.html`
   - Production: `https://your-domain.com/kroger-oauth-callback.html`
3. Copy **Client ID** and **Client Secret** into `kroger-cart.ts` (and rebuild).
4. Ensure your app has access to **Products** (for search) and **Cart** (for add); the OAuth scope used is `product.compact` and `cart.basic:write`.

The in-app help text shows the redirect URI the client expects so you can match it in the portal.

## Configuration

| What | Where | Default |
|------|--------|--------|
| Ollama model | `kroger-cart.ts` → `OLLAMA_MODEL` | `qwen3:8b` |
| Kroger store (location ID) | `kroger-cart.ts` → `KROGER_LOCATION_ID` | (set for your store) |
| Server port | `PORT` env or server default | `8000` |
| Ollama URL (Docker) | `OLLAMA_ORIGIN` env | `http://127.0.0.1:11434` |

Change client options in `kroger-cart.ts`, then run `npm run build:client` (and rebuild the Docker image if you use Docker).

## Project structure

| Path | Purpose |
|------|--------|
| `server.ts` | Express server: static files, Ollama proxy, Kroger proxy + OAuth exchange/refresh |
| `kroger-cart.html` | Single-page UI |
| `kroger-cart.css` | Styles |
| `kroger-cart.ts` | Client logic (TypeScript) → built to `dist/kroger-cart.js` |
| `kroger-oauth-callback.html` | OAuth redirect; exchanges code for tokens |
| `DOCKER.md` | Docker runbook |
| `ARCHITECTURE.md` | Technical overview, decisions, and APIs |

## Scripts

- `npm start` — Run the server (tsx)
- `npm run build:client` — Compile `kroger-cart.ts` → `dist/kroger-cart.js`

## Documentation

- **[DOCKER.md](DOCKER.md)** — Running with Docker, Ollama in/out of containers, 502 fixes.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — How the app is built, technical decisions, Kroger/Ollama integration, security notes.

## License

[Add your license here, e.g. MIT, Apache-2.0, or see LICENSE file.]
