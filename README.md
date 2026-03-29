# Kroger Shopping Cart

Generate a weekly meal plan and grocery list with a local LLM (Ollama), then add items to your **Kroger** cart in one click. Sign in with your Kroger account, pick products when there are multiple matches, and keep your cart in sync—all from a single page.


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

3. **Add your Kroger credentials (server only — never in the browser bundle)**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set at least:

   - `KROGER_CLIENT_ID` — from Kroger Developer Portal  
   - `KROGER_CLIENT_SECRET` — from Kroger Developer Portal (stays on the server)  
   - Optionally `KROGER_REDIRECT_URI` — must match the portal exactly (if omitted locally, the server derives `http://localhost:8000/kroger-oauth-callback.html` from the request)

   Rebuild the client if you only changed TypeScript: `npm run build:client`

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
Pass `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` into the app container (env file or compose `environment:`), not into the client bundle.

For more options (Ollama on host, custom port, 502 troubleshooting), see **[DOCKER.md](DOCKER.md)**.

## Kroger setup

1. Go to [Kroger Developer Portal](https://developer.kroger.com/) and create an application.
2. Under **Redirect URIs**, add the exact URL your app uses for the OAuth callback, e.g.:
   - Local: `http://localhost:8000/kroger-oauth-callback.html`
   - Production: `https://your-domain.com/kroger-oauth-callback.html`
3. Copy **Client ID** and **Client Secret** into the **server** environment (`.env` or your host’s secret store), not the frontend.
4. Ensure your app has access to **Products** (for search) and **Cart** (for add); the OAuth scope used is `product.compact` and `cart.basic:write`.

The in-app help text shows the redirect URI the client expects so you can match it in the portal.

## Configuration

| What | Where | Default |
|------|--------|--------|
| Kroger ID / secret | Server env: `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | (required) |
| OAuth redirect | `KROGER_REDIRECT_URI` or derived from request | see `.env.example` |
| Ollama model name | `OLLAMA_MODEL` | `qwen3:8b` |
| Kroger store (location ID) | `KROGER_LOCATION_ID` | optional |
| Server port | `PORT` | `8000` |
| Ollama URL (proxy target) | `OLLAMA_ORIGIN` | `http://127.0.0.1:11434` |
| LLM backend | `LLM_PROVIDER` | `ollama` unless `FEATHERLESS_API_KEY` is set, then `featherless` |
| Featherless API key (server only) | `FEATHERLESS_API_KEY` | (optional; [Featherless.ai](https://featherless.ai/docs/overview)) |
| Featherless API base | `FEATHERLESS_API_BASE` | `https://api.featherless.ai/v1` |
| Model id (Ollama or Featherless) | `LLM_MODEL` (falls back to `OLLAMA_MODEL` / `FEATHERLESS_MODEL`) | `qwen3:8b` or `Qwen/Qwen2.5-7B-Instruct` by provider |

The browser loads **public** settings from `GET /api/public-config` (no secrets). See `.env.example`.

**Featherless.ai:** Set `FEATHERLESS_API_KEY` (and optionally `LLM_PROVIDER=featherless`, `LLM_MODEL=<model id from Featherless>`). The server calls OpenAI-compatible `POST …/v1/chat/completions` and streams results through the existing `/ollama-api` path so the UI does not expose your key.

## Project structure

| Path | Purpose |
|------|--------|
| `server.ts` | Express server: static files, Ollama proxy, Kroger proxy + OAuth exchange/refresh |
| `kroger-cart.html` | Single-page UI |
| `kroger-cart.css` | Styles |
| `client/` | Browser app source (TypeScript modules); `npm run build:client` typechecks with `tsc` and bundles to `dist/kroger-cart.js` with esbuild |
| `kroger-oauth-callback.html` | OAuth redirect; exchanges code for tokens |
| `DOCKER.md` | Docker runbook |
| `ARCHITECTURE.md` | Technical overview, decisions, and APIs |

## Scripts

- `npm start` — Run the server (tsx)
- `npm run build:client` — Typecheck client with `tsc`, bundle `client/kroger-cart.ts` → `dist/kroger-cart.js` (ESM)

## Documentation

- **[DOCKER.md](DOCKER.md)** — Running with Docker, Ollama in/out of containers, 502 fixes.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — How the app is built, technical decisions, Kroger/Ollama integration, security notes.
- **[SAAS-NEXT-STEPS.md](SAAS-NEXT-STEPS.md)** — Roadmap for hosted SaaS: auth, billing, legal, ops.
- **[AWS-DEPLOY.md](AWS-DEPLOY.md)** — Cognito, DynamoDB, Stripe webhooks, ECS/ALB, monitoring on AWS.

## License

[Add your license here, e.g. MIT, Apache-2.0, or see LICENSE file.]
