/** Public deployment settings from the server (no secrets). Loaded once at startup. */

export interface PublicConfig {
  krogerClientId: string;
  krogerRedirectUri: string;
  krogerLocationId: string;
  ollamaModel: string;
  cognitoDomain: string;
  cognitoClientId: string;
  cognitoRedirectUri: string;
  authRequired: boolean;
  /** When true, main page does not force redirect to login; header Sign in / Create account instead. */
  authAllowAnonymousBrowsing: boolean;
  subscriptionRequired: boolean;
}

let cached: PublicConfig | null = null;

/** Origin of the Express API (proxies, /api, /kroger-api, /ollama-api). Filled after initBackendOrigin(). */
let backendOriginCache: string | null = null;

/**
 * When the UI is on static hosting (e.g. Amplify) and the API is elsewhere, deploy-config.json
 * provides { "apiOrigin": "https://api.example.com" }. Otherwise the page origin is used.
 */
export async function initBackendOrigin(): Promise<string> {
  if (backendOriginCache !== null) return backendOriginCache;
  if (typeof window === "undefined") {
    backendOriginCache = "";
    return "";
  }
  try {
    const r = await fetch("/deploy-config.json", { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { apiOrigin?: string };
      const o = j.apiOrigin?.trim().replace(/\/$/, "");
      if (o && /^https?:\/\//i.test(o)) {
        backendOriginCache = o;
        return o;
      }
    }
  } catch {
    /* use page origin */
  }
  backendOriginCache = window.location.origin;
  return backendOriginCache;
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

export async function ensurePublicConfig(): Promise<PublicConfig> {
  if (cached) return cached;
  await initBackendOrigin();
  const res = await fetch(apiUrl("/api/public-config"));
  if (!res.ok) {
    throw new Error("Failed to load app configuration (HTTP " + res.status + ")");
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  cached = {
    krogerClientId: String(raw.krogerClientId ?? ""),
    krogerRedirectUri: String(raw.krogerRedirectUri ?? ""),
    krogerLocationId: String(raw.krogerLocationId ?? ""),
    ollamaModel: String(raw.ollamaModel ?? "qwen3:8b"),
    cognitoDomain: String(raw.cognitoDomain ?? ""),
    cognitoClientId: String(raw.cognitoClientId ?? ""),
    cognitoRedirectUri: String(
      raw.cognitoRedirectUri ?? (origin ? origin + "/auth-callback.html" : "")
    ),
    authRequired: Boolean(raw.authRequired),
    authAllowAnonymousBrowsing: Boolean(raw.authAllowAnonymousBrowsing),
    subscriptionRequired: Boolean(raw.subscriptionRequired),
  };
  return cached;
}

export function getPublicConfig(): PublicConfig {
  if (!cached) {
    throw new Error("App configuration not loaded yet");
  }
  return cached;
}

export function tryGetPublicConfig(): PublicConfig | null {
  return cached;
}

export function getKrogerLocationId(): string {
  return tryGetPublicConfig()?.krogerLocationId ?? "";
}

export function getOllamaModel(): string {
  return tryGetPublicConfig()?.ollamaModel ?? "qwen3:8b";
}

/** Origin used for /kroger-api and /ollama-api (Express when split from static UI). */
export function getAppOrigin(): string {
  return getBackendOrigin();
}
