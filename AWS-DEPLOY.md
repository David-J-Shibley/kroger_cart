# AWS deployment guide

This app is a **Node.js Express** server. Typical production layout:

**Application Load Balancer (HTTPS)** → **ECS Fargate** (or **Elastic Beanstalk**) → **this container** + env vars from **Secrets Manager** / SSM.

## 1. Amazon Cognito

1. Create a **User pool** with email sign-in (or your preferred IdP).
2. Create an **app integration** → **App client**:
   - Enable **Confidential client** (has a **client secret**) for the server-side token exchange used by `/api/auth/cognito-token`.
3. **Hosted UI** (or your own UI): set **Callback URL(s)** to exactly:
   - `https://<your-domain>/auth-callback.html`
   - Local dev: `http://localhost:8000/auth-callback.html`
4. Set **Allowed OAuth flows**: Authorization code grant. **Scopes**: `openid`, `email`.
5. Copy **User pool ID**, **App client ID**, **Client secret**, and the **Cognito domain** (e.g. `myapp.auth.us-east-1.amazoncognito.com`) into env:
   - `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_DOMAIN`
6. Set `AUTH_REQUIRED=true` and `APP_PUBLIC_URL=https://<your-domain>`.
7. Optional: set `AUTH_ALLOW_ANONYMOUS_BROWSING=true` so the home page does not immediately redirect to login; guests see the app and can use **Sign in** / **Create account** in the header. APIs (meal plan, Kroger proxy, etc.) still require a Cognito JWT. Enable **self-registration** on the user pool if you use **Create account** (Hosted UI `/signup`).

JWT verification uses `aws-jwt-verify` (JWKS from Cognito). No VPC endpoint required for that.

## 2. DynamoDB

Create a table (e.g. `grocery-cart-users`):

- **Partition key**: `userId` (String) — value = Cognito `sub`.

Optional IAM policy for the task role:

```json
{
  "Effect": "Allow",
  "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
  "Resource": "arn:aws:dynamodb:REGION:ACCOUNT:table/TABLE_NAME"
}
```

Set `DYNAMODB_USERS_TABLE` to the table name.

## 3. Stripe

1. Create a **Product** and **recurring Price**; copy `price_...` → `STRIPE_PRICE_ID`.
2. **Webhook endpoint**: `https://<your-domain>/api/webhooks/stripe`  
   - Subscribe to at least: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
3. Copy **Signing secret** → `STRIPE_WEBHOOK_SECRET`.
4. **Secret key** → `STRIPE_SECRET_KEY` (store in Secrets Manager).
5. Set `SUBSCRIPTION_REQUIRED=true` when you are ready to enforce payment.

Checkout sessions attach `metadata.cognito_sub` on the subscription so webhooks can map Stripe events back to Cognito users without a GSI on `stripeCustomerId`.

## 4. Ollama

Run Ollama on **private** networking only (same VPC as ECS, or a separate host reachable from the task). Set `OLLAMA_ORIGIN` to the internal URL (e.g. `http://ollama.internal:11434`). Do not expose Ollama `:11434` to the public internet.

## 5. Abuse controls

- **AWS WAF** on the ALB: rate-based rules, IP allowlists, geo rules as needed.
- App-level limits use `express-rate-limit` (env vars in `.env.example`).
- **Kroger / Ollama** proxies require a valid Cognito JWT when `AUTH_REQUIRED=true`.

## 6. Monitoring

- **Amazon CloudWatch Logs**: ECS task logs to a log group; metric filters on `error` / 5xx.
- **Alarms**: ALB `5XXError`, ECS task health, **target response time**.
- Optional: **X-Ray** tracing, or **Sentry** (`SENTRY_DSN`) if you add it later.

## 7. HTTPS

Terminate TLS on the **ALB**. Set `APP_PUBLIC_URL` to the **https** public URL so Stripe and Cognito redirects stay correct. The app sets `trust proxy` so `req.protocol` / `x-forwarded-proto` work behind the load balancer.

---

This is operational guidance, not a full CloudFormation/Terraform module. Adjust IAM and networking to your org’s standards.
