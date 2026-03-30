# Docker

## Build and run

```bash
docker build -t kroger-cart .
docker run -p 8000:8000 --env-file .env kroger-cart
```

Or from the repo root:

```bash
docker compose up -d --build
```

Open **http://localhost:8000/index.html**.

## Environment (`.env`)

Required for meal generation:

- **`FEATHERLESS_API_KEY`** — from [Featherless](https://featherless.ai/account/api-keys)
- **`LLM_MODEL`** — used only when **`deploy-config.json`** is missing from the API working directory (or override with **`DEPLOY_CONFIG_PATH`**). Default: `Qwen/Qwen2.5-7B-Instruct`
- **`deploy-config.json`** — **`llmModels`** (JSON array, try order): on capacity/overload the API tries the next id. **`llmModel`** alone gives a single-model chain. The Docker image copies this file into `/app`; keep static and API copies in sync when UI and API are on different hosts.
- **`DEPLOY_LLM_MODELS`** — optional; when running `scripts/write-deploy-config.mjs`, comma/`;`/newline-separated list written as **`llmModels`** (omit to emit a one-element array from `LLM_MODEL`)

Optional:

- **`FEATHERLESS_API_BASE`** — default `https://api.featherless.ai/v1`
- **`LLM_PROXY_TIMEOUT_MS`** — upstream timeout in ms (default `600000`)

Also set Kroger, Cognito, Stripe/DynamoDB, etc. as needed (see `README.md`).

## Troubleshooting

**502 / meal plan errors** — Confirm `FEATHERLESS_API_KEY`, outbound HTTPS to `api.featherless.ai`, and that ids in **`llmModels`** (or `LLM_MODEL`) are enabled on your Featherless plan.

**Split hosting** — `deploy-config.json` `apiOrigin` must point at this Express app. Forward **`/llm-api`** (or set `llmProxyPrefix` to match your ingress).
