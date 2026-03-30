/** Public deployment settings from static `deploy-config.json` (same origin as the HTML). No /api/public-config. */

import { SAVED_LLM_MODEL_KEY } from "./config.js";

const DEFAULT_LLM_MODEL = "Qwen/Qwen2.5-7B-Instruct";

function parseLlmModelsRaw(raw: unknown): string[] {
  const seen = new Set<string>();
  const add = (s: string): void => {
    const t = s.trim();
    if (t) seen.add(t);
  };
  if (Array.isArray(raw)) {
    for (const x of raw) add(String(x));
  } else if (typeof raw === "string") {
    for (const part of raw.split(/[,;\n]/)) add(part);
  }
  return [...seen];
}

/** Merge deploy `llmModels` with default `llmModel`; empty raw → no multi-model UI. */
function resolveLlmModelOptions(rawList: unknown, baseModel: string): string[] {
  let list = parseLlmModelsRaw(rawList);
  if (list.length === 0) return [];
  if (!list.includes(baseModel)) list = [baseModel, ...list];
  return list;
}

export interface PublicConfig {
  krogerClientId: string;
  krogerRedirectUri: string;
  krogerLocationId: string;
  /** Featherless / HuggingFace-style model id (must exist on your Featherless plan). */
  llmModel: string;
  /**
   * When two or more ids are present (from optional `llmModels` in deploy-config), the UI shows a model dropdown
   * so users can switch if one model hits capacity. Omitted or empty → single fixed `llmModel`.
   */
  llmModelOptions: string[];
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

  const llmModel =
    String(raw.llmModel ?? raw.featherlessModel ?? DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL;
  const llmModelOptions = resolveLlmModelOptions(raw.llmModels ?? raw.llmModelList, llmModel);
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
    llmModel,
    llmModelOptions,
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

/** Featherless model id: dropdown selection if present, else saved choice, else deploy-config default. */
export function getLlmModel(): string {
  const cfg = tryGetPublicConfig();
  const fallback = (cfg?.llmModel && cfg.llmModel.trim()) || DEFAULT_LLM_MODEL;
  const options = cfg?.llmModelOptions ?? [];

  if (typeof document !== "undefined") {
    const sel = document.getElementById("llmModelSelect");
    if (sel instanceof HTMLSelectElement && sel.options.length > 0) {
      const v = sel.value.trim();
      if (v && (options.length === 0 || options.includes(v))) return v;
    }
  }

  if (options.length >= 2) {
    try {
      const saved = localStorage.getItem(SAVED_LLM_MODEL_KEY);
      if (saved && options.includes(saved)) return saved;
    } catch {
      /* storage blocked */
    }
  }

  if (options.length >= 1) {
    if (options.includes(fallback)) return fallback;
    return options[0];
  }

  return fallback;
}

export function getLlmProxyPrefix(): string {
  return tryGetPublicConfig()?.llmProxyPrefix ?? "/llm-api";
}

/** Origin used for /kroger-api and LLM proxy (Express when split from static UI). */
export function getAppOrigin(): string {
  return getBackendOrigin();
}
