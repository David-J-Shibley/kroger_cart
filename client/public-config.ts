/** Public deployment settings from static `deploy-config.json` (same origin as the HTML). No /api/public-config. */

const DEFAULT_LLM_MODEL = "Qwen/Qwen2.5-7B-Instruct";

export interface PublicConfig {
  krogerClientId: string;
  krogerRedirectUri: string;
  krogerLocationId: string;
  /** Featherless / HuggingFace-style model id (must exist on your Featherless plan). */
  llmModel: string;
  /**
   * Path prefix for meal LLM POST …/api/chat. Default `/llm-api`.
   * Use a different prefix only if your ingress still points at an older path (server may mount both).
   */
  llmProxyPrefix: string;
  cognitoDomain: string;
  cognitoClientId: string;
  cognitoRedirectUri: string;
  authRequired: boolean;
  /** When true, main page does not force redirect to login; header Sign in / Create account instead. */
  authAllowAnonymousBrowsing: boolean;
  subscriptionRequired: boolean;
  /** Must match server cookie session mode (COOKIE_APP_SESSION + Dynamo + secret). */
  cookieSessionAuth: boolean;
  /** Server set TEST=true in env — mirror here for dev UI if you want test controls. */
  testMode: boolean;
}

let cached: PublicConfig | null = null;

/** Origin of the Express API (proxies, /api, /kroger-api, /llm-api). Filled after loadDeployConfig(). */
let backendOriginCache: string | null = null;

/** Keys we must not keep in the browser when the server uses HttpOnly cookie sessions. */
const LEGACY_BROWSER_SECRET_KEYS = [
  "appCognitoAccessToken",
  "appCognitoRefreshToken",
  "appCognitoIdToken",
  "krogerUserToken",
  "krogerUserTokenExpiry",
  "krogerUserRefreshToken",
] as const;

function clearLegacyBrowserSecretsIfCookieSession(cookieSessionAuth: boolean): void {
  if (!cookieSessionAuth || typeof window === "undefined") return;
  try {
    for (const k of LEGACY_BROWSER_SECRET_KEYS) {
      localStorage.removeItem(k);
    }
  } catch {
    /* storage blocked */
  }
}

function pageOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

/** `apiOrigin` must be an absolute URL; accept bare hostnames and add http/https. */
function normalizeApiOrigin(apiRaw: string, pageOriginFallback: string): string {
  let s = apiRaw.trim().replace(/\/$/, "");
  if (!s) return pageOriginFallback || "";
  if (/^https?:\/\//i.test(s)) return s;
  const lower = s.toLowerCase();
  const scheme =
    lower.startsWith("localhost") ||
    lower.startsWith("127.0.0.1") ||
    lower.startsWith("[::1]")
      ? "http://"
      : "https://";
  return scheme + s.replace(/^\/+/, "");
}

/** Match server `normalizeCognitoDomain` — Hosted UI host only (no https://, no path). */
function normalizeCognitoDomain(raw: string): string {
  let s = String(raw).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  return s;
}

/**
 * Loads `/deploy-config.json` from the **page** origin (static site), not the API host.
 * `apiOrigin` in that file points at the Express API when UI and API are split.
 */
export async function loadDeployConfig(): Promise<PublicConfig> {
  if (cached) return cached;
  const origin = pageOrigin();
  const res = await fetch(`${origin}/deploy-config.json`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      "Missing or invalid deploy-config.json (HTTP " +
        res.status +
        "). Copy deploy-config.sample.json to deploy-config.json and fill in values."
    );
  }
  const raw = (await res.json()) as Record<string, unknown>;
  backendOriginCache = normalizeApiOrigin(
    typeof raw.apiOrigin === "string" ? raw.apiOrigin : "",
    origin
  );

  const llmModel = String(raw.llmModel ?? raw.featherlessModel ?? DEFAULT_LLM_MODEL).trim();
  const prefixRaw = String(raw.llmProxyPrefix ?? "").trim().replace(/\/$/, "");
  const llmProxyPrefix =
    prefixRaw && prefixRaw.startsWith("/")
      ? prefixRaw
      : prefixRaw
        ? "/" + prefixRaw.replace(/^\/+/, "")
        : "/llm-api";
  const cookieSessionAuth = Boolean(raw.cookieSessionAuth);
  cached = {
    krogerClientId: String(raw.krogerClientId ?? ""),
    krogerRedirectUri: String(raw.krogerRedirectUri ?? ""),
    krogerLocationId: String(raw.krogerLocationId ?? ""),
    llmModel: llmModel || DEFAULT_LLM_MODEL,
    llmProxyPrefix,
    cognitoDomain: normalizeCognitoDomain(String(raw.cognitoDomain ?? "")),
    cognitoClientId: String(raw.cognitoClientId ?? ""),
    cognitoRedirectUri: String(
      raw.cognitoRedirectUri ?? (origin ? origin + "/auth-callback.html" : "")
    ),
    authRequired: Boolean(raw.authRequired),
    authAllowAnonymousBrowsing: Boolean(raw.authAllowAnonymousBrowsing),
    subscriptionRequired: Boolean(raw.subscriptionRequired),
    cookieSessionAuth,
    testMode: Boolean(raw.testMode),
  };
  clearLegacyBrowserSecretsIfCookieSession(cookieSessionAuth);
  return cached;
}

/** @deprecated Use loadDeployConfig — name kept for call sites. */
export async function ensurePublicConfig(): Promise<PublicConfig> {
  return loadDeployConfig();
}

/** @deprecated Use loadDeployConfig — init order is now inside loadDeployConfig. */
export async function initBackendOrigin(): Promise<string> {
  await loadDeployConfig();
  return getBackendOrigin();
}

export function getPublicConfig(): PublicConfig {
  if (!cached) {
    throw new Error("App configuration not loaded yet — call loadDeployConfig() first");
  }
  return cached;
}

export function tryGetPublicConfig(): PublicConfig | null {
  return cached;
}

export function getBackendOrigin(): string {
  if (backendOriginCache !== null) return backendOriginCache;
  return typeof window !== "undefined" ? window.location.origin : "";
}

/** Absolute URL for API/proxy paths (e.g. "/api/me" → https://api…/api/me). */
export function apiUrl(path: string): string {
  const b = getBackendOrigin();
  const p = path.startsWith("/") ? path : "/" + path;
  return b + p;
}

export function getKrogerLocationId(): string {
  return tryGetPublicConfig()?.krogerLocationId ?? "";
}

/** Featherless model id from deploy-config. */
export function getLlmModel(): string {
  const m = tryGetPublicConfig()?.llmModel;
  return (m && m.trim()) || DEFAULT_LLM_MODEL;
}

export function getLlmProxyPrefix(): string {
  return tryGetPublicConfig()?.llmProxyPrefix ?? "/llm-api";
}

/** Origin used for /kroger-api and LLM proxy (Express when split from static UI). */
export function getAppOrigin(): string {
  return getBackendOrigin();
}
