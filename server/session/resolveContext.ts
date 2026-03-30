import { randomBytes } from "crypto";
import type { Request } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { cognitoRefreshWithRefreshToken } from "./cognitoRefresh.js";
import { openSessionPayload, sealSessionPayload } from "./crypto.js";
import { APP_SESSION_COOKIE_NAME } from "./constants.js";
import { extractKrogerPayloadFields } from "./krogerSession.js";
import { deleteSessionRow, getSessionRow, putSessionRow } from "./sessionStore.js";

export type CognitoUserTokenContext = {
  accessToken: string;
  idToken?: string;
};

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

function jwtExpMs(jwt: string): number | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function readTokenStrings(payload: Record<string, unknown>): {
  accessToken: string;
  refreshToken: string;
  idToken: string;
} | null {
  const accessToken =
    typeof payload.accessToken === "string" ? payload.accessToken.replace(/\s+/g, "").trim() : "";
  const refreshToken =
    typeof payload.refreshToken === "string" ? payload.refreshToken.replace(/\s+/g, "").trim() : "";
  const idToken =
    typeof payload.idToken === "string" ? payload.idToken.replace(/\s+/g, "").trim() : "";
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, idToken };
}

async function tokensFromCookieSession(req: Request): Promise<CognitoUserTokenContext | null> {
  if (!config.cookieAppSessionEnabled) return null;
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[APP_SESSION_COOKIE_NAME]?.trim();
  if (!sessionId) return null;

  const row = await getSessionRow(sessionId);
  if (!row) return null;

  let data: Record<string, unknown>;
  try {
    data = openSessionPayload(config.appSessionSecret, row.sealed);
  } catch (e) {
    logger.warn({ err: e, sessionId }, "session decrypt failed");
    await deleteSessionRow(sessionId);
    return null;
  }

  const tokens = readTokenStrings(data);
  if (!tokens) {
    await deleteSessionRow(sessionId);
    return null;
  }

  let accessToken = tokens.accessToken;
  let refreshToken = tokens.refreshToken;
  let idToken = tokens.idToken || undefined;

  const expMs = jwtExpMs(accessToken);
  const stale = expMs != null && Date.now() > expMs - 90_000;

  if (stale) {
    try {
      const refreshed = await cognitoRefreshWithRefreshToken(refreshToken);
      const newAccess =
        typeof refreshed.access_token === "string"
          ? refreshed.access_token.replace(/\s+/g, "").trim()
          : "";
      const newRefresh =
        typeof refreshed.refresh_token === "string"
          ? refreshed.refresh_token.replace(/\s+/g, "").trim()
          : refreshToken;
      const newId =
        typeof refreshed.id_token === "string"
          ? refreshed.id_token.replace(/\s+/g, "").trim()
          : idToken || "";
      if (!newAccess) {
        throw new Error("no_access_token");
      }
      accessToken = newAccess;
      refreshToken = newRefresh;
      idToken = newId || undefined;
      const sealed = sealSessionPayload(config.appSessionSecret, {
        accessToken,
        refreshToken,
        idToken: idToken || "",
        ...extractKrogerPayloadFields(data),
      });
      await putSessionRow({
        sessionId,
        sealed,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn({ err: e, sessionId }, "session refresh failed — clearing");
      await deleteSessionRow(sessionId);
      return null;
    }
  }

  return { accessToken, idToken };
}

/**
 * Prefer `Authorization: Bearer` (legacy SPA / tools); else HttpOnly cookie + Dynamo session.
 */
export async function resolveCognitoUserContext(req: Request): Promise<CognitoUserTokenContext | null> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const raw = typeof authHeader === "string" ? authHeader : Array.isArray(authHeader) ? authHeader[0] : "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (m?.[1]?.trim()) {
    return { accessToken: m[1].trim() };
  }
  return tokensFromCookieSession(req);
}

export async function createServerAppSession(
  cognitoTokenJson: Record<string, unknown>
): Promise<string> {
  const access =
    typeof cognitoTokenJson.access_token === "string"
      ? cognitoTokenJson.access_token.replace(/\s+/g, "").trim()
      : "";
  const refresh =
    typeof cognitoTokenJson.refresh_token === "string"
      ? cognitoTokenJson.refresh_token.replace(/\s+/g, "").trim()
      : "";
  const idTok =
    typeof cognitoTokenJson.id_token === "string"
      ? cognitoTokenJson.id_token.replace(/\s+/g, "").trim()
      : "";
  if (!access || !refresh) {
    throw new Error("missing_tokens_for_session");
  }
  const sessionId = randomBytes(32).toString("hex");
  const sealed = sealSessionPayload(config.appSessionSecret, {
    accessToken: access,
    refreshToken: refresh,
    idToken: idTok,
  });
  await putSessionRow({
    sessionId,
    sealed,
    updatedAt: new Date().toISOString(),
  });
  return sessionId;
}
