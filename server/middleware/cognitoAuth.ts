import type { NextFunction, Request, Response } from "express";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { config } from "../config.js";
import { logger } from "../logger.js";

/** Optional Bearer verification for public routes (e.g. feedback). */
export type CognitoBearerResolution =
  | { ok: true; sub: string }
  | { ok: false; reason: "missing" | "invalid_config" | "invalid_token" };

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;
let idTokenVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
  if (!config.cognitoUserPoolId || !config.cognitoClientId) {
    return null;
  }
  if (!verifier) {
    const clientIds = config.cognitoClientId.split(",").map((s) => s.trim()).filter(Boolean);
    verifier = CognitoJwtVerifier.create({
      userPoolId: config.cognitoUserPoolId,
      tokenUse: "access",
      clientId: clientIds,
    });
  }
  return verifier;
}

/** ID tokens carry `email`; access tokens often do not — used only to enrich `req.appUserEmail`. */
function getIdTokenVerifier() {
  if (!config.cognitoUserPoolId || !config.cognitoClientId) {
    return null;
  }
  if (!idTokenVerifier) {
    const clientIds = config.cognitoClientId.split(",").map((s) => s.trim()).filter(Boolean);
    idTokenVerifier = CognitoJwtVerifier.create({
      userPoolId: config.cognitoUserPoolId,
      tokenUse: "id",
      clientId: clientIds,
    });
  }
  return idTokenVerifier;
}

function headerString(req: Request, name: string): string {
  const raw = req.headers[name.toLowerCase()] ?? req.headers[name];
  return typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : "";
}

/**
 * If no `Authorization` header → `missing`. If Bearer present but invalid → `invalid_token`.
 * Used when a route is public but should attribute submissions to Cognito `sub` when logged in.
 */
export async function resolveCognitoBearerSub(req: Request): Promise<CognitoBearerResolution> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const raw = typeof authHeader === "string" ? authHeader : Array.isArray(authHeader) ? authHeader[0] : "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]?.trim()) {
    return { ok: false, reason: "missing" };
  }
  const v = getVerifier();
  if (!v) {
    return { ok: false, reason: "invalid_config" };
  }
  try {
    const payload = await v.verify(m[1]);
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub) return { ok: false, reason: "invalid_token" };
    return { ok: true, sub };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}

/**
 * Expects `Authorization: Bearer <Cognito access token>`.
 * Kroger tokens must be sent as `X-Kroger-Authorization: Bearer ...` (see kroger proxy).
 */
export async function cognitoAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  if (!config.authRequired) {
    req.appUserId = "dev";
    req.appUserEmail = "dev@local";
    req.appUsername = "dev";
    next();
    return;
  }

  const v = getVerifier();
  if (!v) {
    logger.error("AUTH_REQUIRED but COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID missing");
    res.status(503).json({ error: "Authentication not configured on server" });
    return;
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  const raw = typeof authHeader === "string" ? authHeader : Array.isArray(authHeader) ? authHeader[0] : "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (!m || !m[1]) {
    res.status(401).json({ error: "Unauthorized", error_description: "Missing Cognito Bearer token" });
    return;
  }

  try {
    const payload = await v.verify(m[1]);
    req.appUserId = typeof payload.sub === "string" ? payload.sub : "";
    req.appUsername =
      typeof (payload as { username?: string }).username === "string"
        ? (payload as { username?: string }).username
        : undefined;
    /** Access token rarely includes `email`; prefer verified ID token below. */
    let email = typeof payload.email === "string" ? payload.email : undefined;

    const idRaw = headerString(req, "x-cognito-id-token").replace(/^\s*Bearer\s+/i, "").trim();
    const idV = getIdTokenVerifier();
    if (idRaw && idV && req.appUserId) {
      try {
        const idPayload = await idV.verify(idRaw);
        if (idPayload.sub === req.appUserId && typeof idPayload.email === "string" && idPayload.email.trim()) {
          email = idPayload.email.trim();
        }
      } catch {
        /* stale or forged id token — do not fail the request */
      }
    }

    req.appUserEmail = email;
    next();
  } catch (e) {
    logger.warn({ err: e }, "Cognito JWT verification failed");
    res.status(401).json({ error: "Unauthorized", error_description: "Invalid or expired token" });
  }
}
