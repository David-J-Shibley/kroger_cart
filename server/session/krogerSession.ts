import type { Request } from "express";
import { config, getKrogerCredentials } from "../config.js";
import { logger } from "../logger.js";
import { APP_SESSION_COOKIE_NAME } from "./constants.js";
import { openSessionPayload, sealSessionPayload } from "./crypto.js";
import { getSessionRow, putSessionRow } from "./sessionStore.js";

const KROGER_API = "https://api.kroger.com";

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function cookieSessionId(req: Request): string | null {
  const id = parseCookies(req.headers.cookie)[APP_SESSION_COOKIE_NAME]?.trim();
  return id || null;
}

/** Kroger fields to merge into the same sealed blob as Cognito (cookie session only). */
export function extractKrogerPayloadFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof data.krogerAccessToken === "string" && data.krogerAccessToken) {
    out.krogerAccessToken = String(data.krogerAccessToken).replace(/\s+/g, "").trim();
  }
  if (typeof data.krogerRefreshToken === "string" && data.krogerRefreshToken) {
    out.krogerRefreshToken = String(data.krogerRefreshToken).replace(/\s+/g, "").trim();
  }
  if (typeof data.krogerAccessExpiresAtMs === "number" && !Number.isNaN(data.krogerAccessExpiresAtMs)) {
    out.krogerAccessExpiresAtMs = data.krogerAccessExpiresAtMs;
  }
  return out;
}

export function sessionPayloadHasKrogerLink(data: Record<string, unknown>): boolean {
  const r = typeof data.krogerRefreshToken === "string" && data.krogerRefreshToken.length > 0;
  const a = typeof data.krogerAccessToken === "string" && data.krogerAccessToken.length > 0;
  const exp = typeof data.krogerAccessExpiresAtMs === "number" && data.krogerAccessExpiresAtMs > Date.now();
  return r || a || exp;
}

function canonicalSessionRecord(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof data.accessToken === "string") out.accessToken = data.accessToken;
  if (typeof data.refreshToken === "string") out.refreshToken = data.refreshToken;
  if (typeof data.idToken === "string") out.idToken = data.idToken;
  Object.assign(out, extractKrogerPayloadFields(data));
  return out;
}

async function readOpenedSession(
  req: Request
): Promise<{ sessionId: string; data: Record<string, unknown> } | null> {
  if (!config.cookieAppSessionEnabled) return null;
  const sessionId = cookieSessionId(req);
  if (!sessionId) return null;
  const row = await getSessionRow(sessionId);
  if (!row) return null;
  try {
    const data = openSessionPayload(config.appSessionSecret, row.sealed);
    return { sessionId, data };
  } catch (e) {
    logger.warn({ err: e, sessionId }, "krogerSession: decrypt failed");
    return null;
  }
}

async function writeSessionData(sessionId: string, data: Record<string, unknown>): Promise<void> {
  const sealed = sealSessionPayload(config.appSessionSecret, canonicalSessionRecord(data));
  await putSessionRow({
    sessionId,
    sealed,
    updatedAt: new Date().toISOString(),
  });
}

export async function krogerLinkedFromCookieSession(req: Request): Promise<boolean> {
  const opened = await readOpenedSession(req);
  if (!opened) return false;
  return sessionPayloadHasKrogerLink(opened.data);
}

/** Attach Kroger user tokens to the current HttpOnly app session (after OAuth code exchange). */
export async function mergeKrogerOAuthIntoCookieSession(
  req: Request,
  tokenJson: Record<string, unknown>
): Promise<boolean> {
  const opened = await readOpenedSession(req);
  if (!opened) return false;
  const { accessToken, refreshToken } = opened.data;
  if (typeof accessToken !== "string" || !accessToken.trim()) return false;
  if (typeof refreshToken !== "string" || !refreshToken.trim()) return false;

  const at =
    typeof tokenJson.access_token === "string"
      ? String(tokenJson.access_token).replace(/\s+/g, "").trim()
      : "";
  if (!at) return false;
  const rtNew =
    typeof tokenJson.refresh_token === "string"
      ? String(tokenJson.refresh_token).replace(/\s+/g, "").trim()
      : "";
  const rtExisting =
    typeof opened.data.krogerRefreshToken === "string"
      ? String(opened.data.krogerRefreshToken).replace(/\s+/g, "").trim()
      : "";
  const rt = rtNew || rtExisting;
  if (!rt) return false;

  const expiresInSec =
    typeof tokenJson.expires_in === "number" && tokenJson.expires_in > 0 ? tokenJson.expires_in : 3600;
  const expMs = Date.now() + Math.max(expiresInSec, 300) * 1000;

  const next: Record<string, unknown> = {
    ...opened.data,
    krogerAccessToken: at,
    krogerAccessExpiresAtMs: expMs,
    krogerRefreshToken: rt,
  };

  await writeSessionData(opened.sessionId, next);
  return true;
}

/** Remove Kroger tokens from the app session row (Cognito session unchanged). */
export async function clearKrogerInCookieSession(req: Request): Promise<boolean> {
  const opened = await readOpenedSession(req);
  if (!opened) return false;
  const { data, sessionId } = opened;
  if (!sessionPayloadHasKrogerLink(data)) return true;
  const next = { ...data };
  delete next.krogerAccessToken;
  delete next.krogerRefreshToken;
  delete next.krogerAccessExpiresAtMs;
  await writeSessionData(sessionId, next);
  return true;
}

async function refreshKrogerAccess(refreshToken: string): Promise<{
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}> {
  const creds = getKrogerCredentials();
  if (!creds) throw new Error("no_kroger_creds");
  const basicAuth = Buffer.from(creds.clientId + ":" + creds.clientSecret).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();
  const tokenRes = await fetch(`${KROGER_API}/v1/connect/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + basicAuth,
      "Accept-Encoding": "identity",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  return (await tokenRes.json()) as Record<string, unknown>;
}

/**
 * Authorization header value for upstream Kroger API (Bearer access), or undefined.
 * Prefer client `X-Kroger-Authorization` when present (legacy). Else load from cookie session when enabled.
 */
export async function resolveKrogerProxyAuthorization(req: Request): Promise<string | undefined> {
  const raw =
    req.headers["x-kroger-authorization"] || req.headers["X-Kroger-Authorization"];
  const hv = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : "";
  const trimmed = hv.replace(/^\s*Bearer\s+/i, "").replace(/\s+/g, "").trim();
  if (trimmed) return "Bearer " + trimmed;

  if (!config.cookieAppSessionEnabled) return undefined;

  const opened = await readOpenedSession(req);
  if (!opened) return undefined;

  let data = opened.data;
  let access =
    typeof data.krogerAccessToken === "string" ? data.krogerAccessToken.replace(/\s+/g, "").trim() : "";
  let refresh =
    typeof data.krogerRefreshToken === "string" ? data.krogerRefreshToken.replace(/\s+/g, "").trim() : "";
  const expMs = typeof data.krogerAccessExpiresAtMs === "number" ? data.krogerAccessExpiresAtMs : 0;
  if (!refresh && !access) return undefined;

  const stale = !access || (expMs > 0 && Date.now() > expMs - 90_000);
  if (stale && refresh) {
    try {
      const tok = await refreshKrogerAccess(refresh);
      const newAccess =
        typeof tok.access_token === "string" ? String(tok.access_token).replace(/\s+/g, "").trim() : "";
      if (!newAccess) throw new Error("kroger_refresh_no_access");
      const expiresInSec =
        typeof tok.expires_in === "number" && tok.expires_in > 0 ? tok.expires_in : 3600;
      const newExp = Date.now() + Math.max(expiresInSec, 300) * 1000;
      const newRefresh =
        typeof tok.refresh_token === "string"
          ? String(tok.refresh_token).replace(/\s+/g, "").trim()
          : refresh;
      const next: Record<string, unknown> = {
        ...data,
        krogerAccessToken: newAccess,
        krogerAccessExpiresAtMs: newExp,
        krogerRefreshToken: newRefresh,
      };
      await writeSessionData(opened.sessionId, next);
      access = newAccess;
      data = next;
      refresh = newRefresh;
    } catch (e) {
      logger.warn({ err: e }, "Kroger session refresh failed");
      return undefined;
    }
  }

  if (!access) return undefined;
  return "Bearer " + access;
}
