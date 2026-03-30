import { cognitoHostedUiDomainIssue, config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Refresh Cognito tokens using a refresh_token (server-side only).
 */
export async function cognitoRefreshWithRefreshToken(refreshToken: string): Promise<Record<string, unknown>> {
  const domain = config.cognitoDomain;
  const clientId = config.cognitoClientId;
  const clientSecret = config.cognitoClientSecret;
  if (!domain || !clientId || !clientSecret) {
    throw new Error("cognito_not_configured");
  }
  const domainIssue = cognitoHostedUiDomainIssue(domain);
  if (domainIssue) {
    throw new Error(domainIssue);
  }
  const tokenUrl = `https://${domain}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId.split(",")[0].trim(),
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    logger.warn({ status: r.status, json }, "Cognito refresh failed");
    throw new Error(typeof json.error === "string" ? json.error : "refresh_failed");
  }
  return json;
}
