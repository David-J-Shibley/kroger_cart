import { getCognitoAccessToken } from "./auth-session.js";

/** Merge Cognito `Authorization` into a fetch init (Kroger tokens use `X-Kroger-Authorization`). */
export function mergeAppAuth(init: RequestInit = {}): RequestInit {
  const token = getCognitoAccessToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", "Bearer " + token.replace(/\s+/g, "").trim());
  }
  return { ...init, headers };
}

/** For Kroger API proxy: app JWT + Kroger bearer in X-Kroger-Authorization. */
export function krogerProxyHeaders(krogerBearerToken: string): Record<string, string> {
  const h: Record<string, string> = {};
  const t = getCognitoAccessToken();
  if (t) h.Authorization = "Bearer " + t.replace(/\s+/g, "").trim();
  const kb = krogerBearerToken.replace(/^Bearer\s+/i, "").replace(/\s+/g, "").trim();
  h["X-Kroger-Authorization"] = "Bearer " + kb;
  return h;
}
