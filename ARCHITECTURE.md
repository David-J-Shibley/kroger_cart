# Kroger Shopping Cart — Technical Overview

This document describes how the app is built, main technical decisions, and details for developers and DevOps.

---

## What the app does

- **Meal plan + grocery list:** **[Featherless.ai](https://featherless.ai)** (OpenAI-compatible HTTP API) generates a meal plan and a consolidated grocery list. The list is parsed from the model output; each line can get an “Add to cart” action.
- **Kroger integration:** Users sign in with Kroger (OAuth 2.0), search products, and add items to their Kroger cart. Multiple search hits open a picker modal (sortable, metadata JSON).
- **Persistence:** Cognito app auth + optional HttpOnly cookie sessions; Kroger tokens refreshed when expired.

---

## Tech stack

| Layer   | Choice                         | Notes |
|---------|---------------------------------|-------|
| Server  | Node.js + Express               | TypeScript, `tsx`. |
| Client  | Vanilla TS → esbuild bundle     | `client/kroger-cart.ts` → `dist/kroger-cart.js` (ESM). |
| Styling | Plain CSS                      | `kroger-cart.css`. |
| LLM     | Featherless.ai                 | Server-side `FEATHERLESS_API_KEY`; streaming via `/llm-api/api/chat`. |
| APIs    | Kroger Products + Cart         | Proxied through `/kroger-api`. |
| Deploy  | Docker                         | See `DOCKER.md`. |

---

## Repository layout

```
krogerCart/
├── server.ts              # Express entry
├── index.html, landing.html, …
├── client/                # Browser TypeScript
├── server/                # Express app, routes, LLM + Kroger proxies
├── dist/kroger-cart.js    # Built client
├── deploy-config.json     # Public browser config (no secrets)
└── Dockerfile, docker-compose.yml
```

The server serves static files and mounts **`/llm-api`** and **`/kroger-api`**. The browser targets `apiOrigin` from `deploy-config.json` when the UI is hosted separately.

---

## LLM path

1. Client POSTs to **`{apiOrigin}{llmProxyPrefix}/api/chat`** (default `llmProxyPrefix` = `/llm-api`) with `stream: true` and newline-delimited JSON chunks shaped like `{ message: { content } }`.
2. Express (`featherlessChat.ts`) calls Featherless `POST /v1/chat/completions`, reads SSE, and rewrites deltas into that NDJSON for the browser.
3. **`FEATHERLESS_API_KEY`** and **`LLM_MODEL`** live only on the server.

---

## Technical decisions (selected)

### Parsing grocery lines from LLM output

The model returns free text (meal plan + “Grocery list:” + items). The client:

- Splits on newlines and looks for “Grocery list:” / “Shopping list:”.
- Filters structural lines (day headers, etc.).
- Strips bullets; uses heuristics if no section header is found.

### Product picker

Search can return many products. The modal lists all hits, sortable by price, with optional raw JSON metadata.

### Kroger tokens

- **App token (client credentials):** product search.
- **User token (OAuth):** cart operations, refreshed via server proxy when needed.

### Security notes

- Kroger client secret and Featherless key are **server-only**.
- `deploy-config.json` holds public IDs and URLs only.
- Use **Cognito JWT** (and optional subscription checks) on `/kroger-api` and LLM routes when `AUTH_REQUIRED=true`.

---

## Configuration

| Variable | Purpose |
|----------|---------|
| `FEATHERLESS_API_KEY` | Required for meal generation |
| `LLM_MODEL` / `FEATHERLESS_MODEL` | Model id (default `Qwen/Qwen2.5-7B-Instruct`) |
| `FEATHERLESS_API_BASE` | Default `https://api.featherless.ai/v1` |
| `LLM_PROXY_TIMEOUT_MS` | Upstream timeout (ms), default 600000 |
| `deploy-config.json` | `apiOrigin`, `llmModel`, optional `llmProxyPrefix`, Kroger/Cognito public fields |

---

## Summary

Thin same-origin UI plus Express proxies for **Featherless** (streaming meal text) and **Kroger** (products, cart, OAuth). Vanilla TS, one bundle, clear split between app-level search and user-level cart.
