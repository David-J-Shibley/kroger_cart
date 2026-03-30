import type { Request, Response } from "express";
import { cognitoHostedUiDomainIssue, config } from "../config.js";
import { logger } from "../logger.js";
import { buildAppSessionSetCookie } from "./appSession.js";
import { createServerAppSession } from "../session/resolveContext.js";

/**
 * Exchange Cognito Hosted UI authorization code for tokens (confidential app client).
 */
export async function postCognitoToken(req: Request, res: Response): Promise<void> {
  const domain = config.cognitoDomain;
  const clientId = config.cognitoClientId;
  const clientSecret = config.cognitoClientSecret;
  if (!domain || !clientId || !clientSecret) {
    res.status(503).json({ error: "Cognito token endpoint not configured" });
    return;
  }

  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const redirectUri = typeof req.body?.redirectUri === "string" ? req.body.redirectUri : "";
  if (!code || !redirectUri) {
    res.status(400).json({ error: "Missing code or redirectUri" });
    return;
  }

  const domainIssue = cognitoHostedUiDomainIssue(domain);
  if (domainIssue) {
    logger.warn({ domain }, "Rejecting token exchange: invalid COGNITO_DOMAIN");
    res.status(400).json({
      error: "invalid_cognito_domain",
      error_description: domainIssue,
    });
    return;
  }

  const tokenUrl = `https://${domain}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId.split(",")[0].trim(),
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  try {
    const r = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await r.json()) as Record<string, unknown>;
    if (!r.ok) {
      logger.warn({ status: r.status, json }, "Cognito token exchange failed");
      res.status(r.status).json(json);
      return;
    }
    if (config.cookieAppSessionEnabled) {
      try {
        const sessionId = await createServerAppSession(json);
        res.append("Set-Cookie", buildAppSessionSetCookie(sessionId, req));
        res.json({ ok: true });
        return;
      } catch (e) {
        logger.error({ err: e }, "Failed to create server session after Cognito exchange");
        res.status(502).json({
          error: "session_create_failed",
          error_description:
            "Could not create browser session. Ensure Cognito returns refresh_token and DYNAMODB_SESSIONS_TABLE is configured.",
        });
        return;
      }
    }
    res.json(json);
  } catch (e) {
    logger.error({ err: e }, "Cognito token fetch failed");
    res.status(502).json({ error: e instanceof Error ? e.message : "Token exchange failed" });
  }
}
