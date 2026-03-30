import { getCognitoAccessToken, getCognitoIdToken } from "./auth-session.js";
import { tryGetPublicConfig } from "./public-config.js";

/** Merge Cognito auth into a fetch init (Kroger tokens use `X-Kroger-Authorization`). */
export function mergeAppAuth(init: RequestInit = {}): RequestInit {
  const cfg = tryGetPublicConfig();
  const cookieMode = Boolean(cfg?.cookieSessionAuth);
  const token = getCognitoAccessToken();
  const idToken = getCognitoIdToken();
  const headers = new Headers(init.headers);
  if (!cookieMode) {
    if (token) {
      headers.set("Authorization", "Bearer " + token.replace(/\s+/g, "").trim());
    }
    if (idToken) {
      headers.set("X-Cognito-Id-Token", idToken.replace(/\s+/g, "").trim());
    }
  }
  const out: RequestInit = { ...init, headers };
  if (cookieMode) {
    out.credentials = init.credentials ?? "include";
  }
  return out;
}

/** For Kroger API proxy: app JWT + Kroger bearer in X-Kroger-Authorization. */
export function krogerProxyHeaders(krogerBearerToken: string): Record<string, string> {
  const h: Record<string, string> = {};
  const cfg = tryGetPublicConfig();
  const cookieMode = Boolean(cfg?.cookieSessionAuth);
  if (!cookieMode) {
    const t = getCognitoAccessToken();
    const id = getCognitoIdToken();
    if (t) h.Authorization = "Bearer " + t.replace(/\s+/g, "").trim();
    if (id) h["X-Cognito-Id-Token"] = id.replace(/\s+/g, "").trim();
  }
  const kb = krogerBearerToken.replace(/^Bearer\s+/i, "").replace(/\s+/g, "").trim();
  if (kb) {
    h["X-Kroger-Authorization"] = "Bearer " + kb;
  }
  return h;
}
