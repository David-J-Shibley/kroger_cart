import type { NextFunction, Request, Response } from "express";

/** Optional Bearer verification for public routes (e.g. feedback). */
export type CognitoBearerResolution =
  | { ok: true; sub: string }
  | { ok: false; reason: "missing" | "invalid_config" | "invalid_token" };
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { config } from "../config.js";
import { logger } from "../logger.js";

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

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
    /** Only the `email` claim — do not use username here (username is stored separately in DynamoDB). */
    req.appUserEmail = typeof payload.email === "string" ? payload.email : undefined;
    next();
  } catch (e) {
    logger.warn({ err: e }, "Cognito JWT verification failed");
    res.status(401).json({ error: "Unauthorized", error_description: "Invalid or expired token" });
  }
}
