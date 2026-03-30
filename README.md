# Kroger Cart

Generate a weekly meal plan and grocery list with **[Featherless.ai](https://featherless.ai)** (OpenAI-compatible API), then add items to your **Kroger** cart in one click. Sign in with your Kroger account, pick products when there are multiple matches, and keep your cart in sync—all from a single page.

## Features

- **Meal plan + grocery list** — LLM generates a meal plan and one consolidated shopping list. Streams output as it’s generated.
- **Kroger integration** — OAuth sign-in, product search, cart add, and refresh-token handling via a server proxy (no Kroger secrets in the browser).
- **Runs locally or in Docker** — Express serves static UI + proxies; set `FEATHERLESS_API_KEY` on the server.

## Prerequisites

- **Node.js** 20+
- **Featherless API key** — [Dashboard](https://featherless.ai/account/api-keys); set `FEATHERLESS_API_KEY` in `.env` (server only).
- **Kroger Developer** app — [Kroger Public API](https://developer.kroger.com/) client ID/secret (server env); redirect URI and location ID in `deploy-config.json`.

## Quick start

```bash
cp deploy-config.sample.json deploy-config.json
# Edit deploy-config.json (Kroger IDs, redirect URIs, apiOrigin if UI and API differ).
# Create .env with FEATHERLESS_API_KEY, KROGER_*, Cognito vars if using auth — see repo docs.
npm install
npm run build:client
npm start
```

Open **http://localhost:8000/index.html** (or **http://localhost:8000/** if `AUTH_REQUIRED` is on).

### Docker

```bash
docker build -t kroger-cart .
docker run -p 8000:8000 --env-file .env kroger-cart
```

Or `docker compose up -d --build` (see **[DOCKER.md](DOCKER.md)**).

## Configuration

| What | Where |
|------|--------|
| Static + browser | `deploy-config.json` (next to `index.html`): `apiOrigin`, Kroger client id, redirects, **`llmModels`** (meal LLM try order), `llmModel`, optional `llmProxyPrefix` (default `/llm-api`) |
| Secrets + server | `.env`: `FEATHERLESS_API_KEY`, `LLM_MODEL` (only if API has no deploy-config), `KROGER_CLIENT_SECRET`, Cognito, Stripe, DynamoDB, etc. |

**LLM proxy:** The server exposes **`POST /llm-api/api/chat`**. The client uses `llmProxyPrefix` from `deploy-config.json` (default `/llm-api`); set it if your ingress uses a different path.

**Featherless:** Server calls `POST …/v1/chat/completions` at `FEATHERLESS_API_BASE` (default `https://api.featherless.ai/v1`). The browser never sees your API key.

## Project layout

| Path | Role |
|------|------|
| `client/` | TypeScript UI — bundled to `dist/kroger-cart.js` |
| `server/` | Express: `/api`, `/llm-api`, `/kroger-api`, static files |
| `server.ts` | Entry |
| `deploy-config.json` | Public browser config (no secrets) |

## Docs

- **[DOCKER.md](DOCKER.md)** — Docker runbook  
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Technical overview  
- **[AWS-DEPLOY.md](AWS-DEPLOY.md)** — AWS / ECS notes  

## License

Use and modify for your own deployment. Kroger and Featherless.ai are subject to their respective terms.
