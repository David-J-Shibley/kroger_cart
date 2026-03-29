import type { Request, Response } from "express";
import { config, getKrogerCredentials } from "../config.js";
import { logger } from "../logger.js";

let loggedCognitoRedirectUri = false;

function requestProtoHost(req: Request): { proto: string; host: string } {
  const host = req.get("host") || "localhost";
  const proto =
    req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
  return { proto, host };
}

/**
 * OAuth redirect_uri for Cognito — must exactly match an entry in “Allowed callback URLs”.
 * If APP_PUBLIC_URL is http://localhost:8000 but you open the app via https://localhost:8000,
 * we use the request’s scheme+host when hosts match so authorize + token exchange stay consistent.
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

export function publicConfigHandler(req: Request, res: Response): void {
  const creds = getKrogerCredentials();
  const { proto, host } = requestProtoHost(req);
  const defaultRedirect = `${proto}://${host}/kroger-oauth-callback.html`;
  const redirectUri = (process.env.KROGER_REDIRECT_URI || "").trim() || defaultRedirect;
  const cognitoClient = config.cognitoClientId.split(",")[0]?.trim() ?? "";
  const cognitoRedirectUri = resolveCognitoRedirectUri(req);

  if (config.authRequired && !loggedCognitoRedirectUri) {
    loggedCognitoRedirectUri = true;
    logger.info(
      { cognitoRedirectUri },
      "Register this exact cognitoRedirectUri in Cognito → App client → Hosted UI → Allowed callback URLs (fixes redirect_mismatch)"
    );
  }

  res.json({
    krogerClientId: creds?.clientId ?? "",
    krogerRedirectUri: redirectUri,
    krogerLocationId: (process.env.KROGER_LOCATION_ID || "").trim(),
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
    /** @deprecated Use llmModel — same value, kept for older clients. */
    ollamaModel: config.llmModel,
    cognitoDomain: config.cognitoDomain,
    cognitoClientId: cognitoClient,
    cognitoRedirectUri,
    authRequired: config.authRequired,
    authAllowAnonymousBrowsing: config.authAllowAnonymousBrowsing,
    subscriptionRequired: config.subscriptionRequired,
    testMode: config.testMode,
  });
}
