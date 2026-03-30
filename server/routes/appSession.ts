import type { Request, Response } from "express";
import { config } from "../config.js";
import { APP_SESSION_COOKIE_MAX_AGE_SEC, APP_SESSION_COOKIE_NAME } from "../session/constants.js";
import { deleteSessionRow } from "../session/sessionStore.js";

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

function sessionCookieSameSite(req: Request): "Lax" | "None" {
  const origin = req.get("origin");
  if (!origin) return "Lax";
  try {
    const oh = new URL(origin).hostname;
    const host = (req.get("host") || "").split(":")[0];
    if (oh && host && oh.toLowerCase() === host.toLowerCase()) return "Lax";
    return "None";
  } catch {
    return "Lax";
  }
}

function isSecureRequest(req: Request): boolean {
  return req.protocol === "https" || req.get("x-forwarded-proto") === "https";
}

function buildSessionCookie(sessionId: string | null, req: Request, maxAge: number): string {
  const secure = isSecureRequest(req);
  let sameSite = sessionCookieSameSite(req);
  if (sameSite === "None" && !secure) {
    sameSite = "Lax";
  }
  const parts =
    maxAge === 0
      ? [`${APP_SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "Max-Age=0"]
      : [
          `${APP_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId!)}`,
          "Path=/",
          "HttpOnly",
          `Max-Age=${maxAge}`,
        ];
  if (secure) parts.push("Secure");
  parts.push(`SameSite=${sameSite}`);
  return parts.join("; ");
}

/** Build Set-Cookie for app session (opaque id only). */
export function buildAppSessionSetCookie(sessionId: string, req: Request): string {
  return buildSessionCookie(sessionId, req, APP_SESSION_COOKIE_MAX_AGE_SEC);
}

export function buildAppSessionClearCookie(req: Request): string {
  return buildSessionCookie(null, req, 0);
}

/** Sign out: delete Dynamo row (if any) and clear cookie. No JWT required. */
export async function deleteAppSessionHandler(req: Request, res: Response): Promise<void> {
  if (!config.cookieAppSessionEnabled) {
    res.status(204).end();
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[APP_SESSION_COOKIE_NAME]?.trim();
  if (sessionId) {
    await deleteSessionRow(sessionId);
  }
  res.append("Set-Cookie", buildAppSessionClearCookie(req));
  res.status(204).end();
}
