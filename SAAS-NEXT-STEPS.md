# Hosted SaaS — next steps

You already have: **secrets on the server**, **GET `/api/public-config`**, **GET `/api/health`**, **trust proxy** for HTTPS behind a load balancer.

## What to add for a sellable SaaS

### 1. Accounts (your product’s users)

- **Option A:** [Clerk](https://clerk.com), [Auth0](https://auth0.com), or [Supabase Auth](https://supabase.com/auth) — fastest path; they handle email/social login and sessions.
- **Option B:** Add your own users table + password hashing (e.g. Argon2) + session cookies — more work, full control.

Gate the HTML or API routes so only paying subscribers reach the app (or use a hosted “login wall” in front of your origin).

### 2. Billing

- **Stripe Billing** — subscriptions + Customer Portal for cancel/update card.
- Flow: user signs up → Stripe Checkout → webhook marks `subscription_active` in your DB → allow access.
- Store `stripe_customer_id` per tenant; verify webhooks with the signing secret.

### 3. Legal & trust

- **Privacy policy** — what you log, cookies, that Kroger tokens stay in the browser, LLM prompts if you log them.
- **Terms of service** — acceptable use, no warranty on prices/inventory, limitation of liability.
- **Cookie banner** if you use non-essential analytics cookies.

Have a lawyer review before selling widely.

### 4. Operations

- **Error tracking:** Sentry (or similar) on the server.
- **Uptime:** uptime monitor on `https://your-domain/api/health`.
- **Logs:** structured JSON logs (e.g. Pino) + retention policy.
- **Alerts:** on 5xx rate or health check failures.

### 5. Hardening (short list)

- Rate limit `/kroger-api/*` and `/llm-api/*` per IP or per user session.
- **CORS:** restrict `Access-Control-Allow-Origin` if you ever expose APIs cross-origin.
- **Content Security Policy** headers on HTML responses.
- Rotate **Kroger** credentials if they were ever committed; use **only** env/secrets manager in production.

### 6. LLM (Featherless) on the web

- Keys stay **server-side**; the browser calls your Express `/llm-api` proxy only.
- Use **per-user daily caps** (already in Dynamo) and rate limits; upgrade Featherless plan or model tier as usage grows.

---

This file is a **roadmap**, not legal or security advice.
