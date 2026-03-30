import type { Request } from "express";
import { config } from "./config.js";

function requestProtoHost(req: Request): { proto: string; host: string } {
  const host = req.get("host") || "localhost";
  const proto =
    req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
  return { proto, host };
}

/**
 * OAuth redirect_uri for Cognito — must exactly match an entry in “Allowed callback URLs”.
 * Used to validate token exchange and for startup documentation.
 */
export function resolveCognitoRedirectUri(req: Request): string {
  const explicit = config.cognitoAuthCallbackUrl.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const { proto, host } = requestProtoHost(req);
  const liveBase = `${proto}://${host}`;
  const configured = config.appPublicUrl.trim().replace(/\/$/, "");
  if (!configured) {
    return `${liveBase}/auth-callback.html`;
  }

  try {
    const configuredUrl = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(configured) ? configured : `http://${configured}`
    );
    const liveUrl = new URL(`${proto}://${host}`);
    if (configuredUrl.host === liveUrl.host) {
      return `${liveBase}/auth-callback.html`;
    }
  } catch {
    /* fall through */
  }
  return `${configured}/auth-callback.html`;
}
