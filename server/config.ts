/**
 * Server environment (see .env.example).
 */
export function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export function envStr(name: string, defaultValue = ""): string {
  const v = process.env[name];
  return v != null && v.trim() !== "" ? v.trim() : defaultValue;
}

/** Cognito Hosted UI host only (no https://, no path). App builds https://${domain}/oauth2/... */
function normalizeCognitoDomain(raw: string): string {
  let s = raw.trim().replace(/^https:\/\//i, "").replace(/\/+$/, "");
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  return s;
}

/**
 * If non-null, COGNITO_DOMAIN will break Hosted UI authorize/token calls (common mistake: user pool issuer URL).
 */
export function cognitoHostedUiDomainIssue(domain: string): string | null {
  if (!domain) return null;
  const d = domain.toLowerCase();
  if (d.includes("cognito-idp.")) {
    return (
      "COGNITO_DOMAIN must be your Cognito Hosted UI domain (e.g. my-app.auth.us-east-2.amazoncognito.com), " +
      "not the issuer URL (cognito-idp.<region>.amazonaws.com). In AWS Console: User pool → App integration → Domain."
    );
  }
  if (d.includes("amazonaws.com") && !d.includes("amazoncognito.com")) {
    return (
      "COGNITO_DOMAIN should be the Hosted UI host ending in .amazoncognito.com (or your custom auth domain), " +
      "not a generic *.amazonaws.com endpoint."
    );
  }
  return null;
}

/**
 * When AUTH_REQUIRED is unset/empty, require login if Cognito is fully wired (Hosted UI + JWT + code exchange).
 * Set AUTH_REQUIRED=false explicitly to keep the app open locally even with Cognito env vars present.
 */
function resolveAuthRequired(): boolean {
  const raw = process.env.AUTH_REQUIRED;
  if (raw != null && raw.trim() !== "") {
    return envBool("AUTH_REQUIRED", false);
  }
  const domain = envStr("COGNITO_DOMAIN");
  const clientId = envStr("COGNITO_CLIENT_ID");
  const poolId = envStr("COGNITO_USER_POOL_ID");
  const clientSecret = envStr("COGNITO_CLIENT_SECRET");
  return Boolean(domain && clientId && poolId && clientSecret);
}

const featherlessApiKey = envStr("FEATHERLESS_API_KEY");

/** Ollama (local/self-hosted) vs Featherless.ai OpenAI-compatible API. */
function resolveLlmProvider(): "ollama" | "featherless" {
  const explicit = envStr("LLM_PROVIDER").toLowerCase();
  if (explicit === "ollama") return "ollama";
  if (explicit === "featherless") return "featherless";
  return featherlessApiKey ? "featherless" : "ollama";
}

const llmProviderResolved = resolveLlmProvider();
const llmModelResolved =
  envStr("LLM_MODEL") ||
  envStr("OLLAMA_MODEL") ||
  envStr("FEATHERLESS_MODEL") ||
  (llmProviderResolved === "featherless" ? "Qwen/Qwen2.5-7B-Instruct" : "qwen3:8b");

export const config = {
  port: parseInt(process.env.PORT || "8000", 10),
  host: process.env.HOST || "0.0.0.0",
  ollamaOrigin: process.env.OLLAMA_ORIGIN || "http://127.0.0.1:11434",
  ollamaProxyTimeoutMs: parseInt(process.env.OLLAMA_PROXY_TIMEOUT_MS || "600000", 10),

  /** Server-side only — never exposed in public-config. */
  featherlessApiKey,
  /** Base URL without trailing slash, e.g. https://api.featherless.ai/v1 */
  featherlessApiBase: envStr("FEATHERLESS_API_BASE", "https://api.featherless.ai/v1").replace(
    /\/+$/,
    ""
  ),
  llmProvider: llmProviderResolved,
  /** Model id for the active provider (Ollama tag or Featherless / HF-style id). */
  llmModel: llmModelResolved.trim(),

  /** Cognito JWT on protected routes; browser redirect to /auth.html when true. */
  authRequired: resolveAuthRequired(),

  /**
   * When true with AUTH_REQUIRED, the main app does not auto-redirect to /auth.html; guests can browse
   * and use Sign in / Create account in the header. APIs still require a JWT.
   */
  authAllowAnonymousBrowsing: envBool("AUTH_ALLOW_ANONYMOUS_BROWSING", false),

  /** Require active Stripe subscription (DynamoDB) after auth. Set true when billing is live. */
  subscriptionRequired: envBool("SUBSCRIPTION_REQUIRED", false),

  cognitoUserPoolId: envStr("COGNITO_USER_POOL_ID"),
  cognitoClientId: envStr("COGNITO_CLIENT_ID"),
  cognitoRegion: envStr("AWS_REGION", "us-east-1"),
  /** e.g. myapp.auth.us-east-1.amazoncognito.com (no https) */
  cognitoDomain: normalizeCognitoDomain(envStr("COGNITO_DOMAIN")),
  cognitoClientSecret: envStr("COGNITO_CLIENT_SECRET"),
  /**
   * Full OAuth redirect URL (must match Cognito “Allowed callback URLs” exactly), e.g.
   * https://localhost:8000/auth-callback.html. Overrides APP_PUBLIC_URL when set.
   */
  cognitoAuthCallbackUrl: envStr("COGNITO_AUTH_CALLBACK_URL"),

  dynamodbUsersTable: envStr("DYNAMODB_USERS_TABLE"),
  /**
   * HttpOnly cookie sessions: encrypted Cognito tokens stored here (not in localStorage).
   * Enable with COOKIE_APP_SESSION=true plus APP_SESSION_SECRET (≥16 chars).
   */
  dynamodbSessionsTable: envStr("DYNAMODB_SESSIONS_TABLE"),
  /** Server-only secret to encrypt session payloads in DynamoDB. */
  appSessionSecret: envStr("APP_SESSION_SECRET"),
  /**
   * When true and sessions table + secret are configured, login uses HttpOnly cookie + Dynamo;
   * tokens are not returned to the browser JSON (mitigates XSS reading localStorage).
   */
  cookieAppSessionEnabled:
    envBool("COOKIE_APP_SESSION", false) &&
    Boolean(envStr("DYNAMODB_SESSIONS_TABLE").trim()) &&
    envStr("APP_SESSION_SECRET").length >= 16,
  /** True when COOKIE_APP_SESSION is set but prerequisites are missing (see startup logs). */
  cookieAppSessionMisconfigured:
    envBool("COOKIE_APP_SESSION", false) &&
    (!Boolean(envStr("DYNAMODB_SESSIONS_TABLE").trim()) || envStr("APP_SESSION_SECRET").length < 16),
  /** Optional — store feedback items for product review (partition key: id String). */
  feedbackTable: envStr("FEEDBACK_TABLE"),
  /** Region for DynamoDB table (defaults to AWS_REGION; can differ from Cognito pool region). */
  dynamodbRegion: envStr("DYNAMODB_REGION") || envStr("AWS_REGION", "us-east-1"),

  stripeSecretKey: envStr("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: envStr("STRIPE_WEBHOOK_SECRET"),
  stripePriceId: envStr("STRIPE_PRICE_ID"),
  /** Public URL of this app for Stripe redirects, e.g. https://app.example.com */
  appPublicUrl: envStr("APP_PUBLIC_URL"),

  /**
   * Comma-separated browser origins allowed to call this API cross-origin (Amplify UI + API on another host).
   * Example: https://main.d123amplifyapp.com,https://staging.d123.amplifyapp.com
   */
  browserCorsOrigins: envStr("BROWSER_CORS_ORIGINS"),

  /** When true, public-config exposes testMode so the client can show dev-only UI (e.g. load example). */
  testMode: envBool("TEST", false),

  logLevel: envStr("LOG_LEVEL", "info"),
};

export function getKrogerCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.KROGER_CLIENT_ID?.trim();
  const clientSecret = process.env.KROGER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
