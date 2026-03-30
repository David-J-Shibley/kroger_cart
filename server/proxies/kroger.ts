import type { Request, Response } from "express";
import { config, getKrogerCredentials } from "../config.js";
import { logger } from "../logger.js";
import { safeClientError } from "../safeError.js";
import {
  mergeKrogerOAuthIntoCookieSession,
  resolveKrogerProxyAuthorization,
} from "../session/krogerSession.js";

const KROGER_ORIGIN = "https://api.kroger.com";


export async function krogerProxyMiddleware(req: Request, res: Response, next: () => void): Promise<void> {
  const pathname = req.originalUrl?.split("?")[0] ?? req.path ?? "";
  if (!pathname.startsWith("/kroger-api")) {
    next();
    return;
  }

  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Kroger-Authorization, X-Cognito-Id-Token"
    );
    res.sendStatus(204);
    return;
  }

  if (pathname === "/kroger-api/token" && req.method === "POST") {
    try {
      const creds = getKrogerCredentials();
      if (!creds) {
        res.status(503).json({
          error: "Kroger credentials not configured",
          error_description: "Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET on the server.",
        });
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as ArrayBuffer));
      }
      const clientId = creds.clientId;
      const clientSecret = creds.clientSecret;
      const basicAuth = Buffer.from(clientId + ":" + clientSecret).toString("base64");
      const tokenRes = await fetch(`${KROGER_ORIGIN}/v1/connect/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + basicAuth,
          "Accept-Encoding": "identity",
        },
        body: "grant_type=client_credentials&scope=product.compact",
        signal: AbortSignal.timeout(15_000),
      });
      const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
      if (tokenJson && typeof tokenJson.access_token === "string") {
        tokenJson.access_token = (tokenJson.access_token as string).replace(/\s+/g, "").trim();
      }
      res.status(tokenRes.status).set("Content-Type", "application/json");
      res.end(JSON.stringify(tokenJson));
      return;
    } catch (err) {
      res.status(502).json(safeClientError(err, "Kroger token request failed."));
      return;
    }
  }

  if (pathname === "/kroger-api/oauth-exchange" && req.method === "POST") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as ArrayBuffer));
      }
      const raw = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        code?: string;
        redirectUri?: string;
      };
      const { code, redirectUri } = raw;
      if (!code || !redirectUri) {
        res.status(400).json({ error: "Missing code or redirectUri" });
        return;
      }
      const creds = getKrogerCredentials();
      if (!creds) {
        res.status(503).json({
          error: "Kroger credentials not configured",
          error_description: "Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET on the server.",
        });
        return;
      }
      const basicAuth = Buffer.from(creds.clientId + ":" + creds.clientSecret).toString("base64");
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
      }).toString();
      const tokenRes = await fetch(`${KROGER_ORIGIN}/v1/connect/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + basicAuth,
          "Accept-Encoding": "identity",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
      if (tokenJson && typeof tokenJson.access_token === "string") {
        tokenJson.access_token = (tokenJson.access_token as string).replace(/\s+/g, "").trim();
      }
      if (config.cookieAppSessionEnabled && tokenRes.ok && tokenJson.access_token) {
        const merged = await mergeKrogerOAuthIntoCookieSession(req, tokenJson);
        if (!merged) {
          if (!config.authRequired) {
            res.status(tokenRes.status).set("Content-Type", "application/json");
            res.end(JSON.stringify(tokenJson));
            return;
          }
          res.status(401).json({
            error: "app_session_required",
            error_description:
              "Sign in to the app first (cookie session), then link your Kroger account.",
          });
          return;
        }
        res.status(200).set("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.status(tokenRes.status).set("Content-Type", "application/json");
      res.end(JSON.stringify(tokenJson));
      return;
    } catch (err) {
      if (!res.headersSent) res.status(502).json(safeClientError(err, "Kroger sign-in exchange failed."));
      return;
    }
  }

  if (pathname === "/kroger-api/oauth-refresh" && req.method === "POST") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as ArrayBuffer));
      }
      const raw = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        refreshToken?: string;
      };
      const { refreshToken } = raw;
      if (!refreshToken) {
        res.status(400).json({ error: "Missing refreshToken" });
        return;
      }
      const creds = getKrogerCredentials();
      if (!creds) {
        res.status(503).json({
          error: "Kroger credentials not configured",
          error_description: "Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET on the server.",
        });
        return;
      }
      const basicAuth = Buffer.from(creds.clientId + ":" + creds.clientSecret).toString("base64");
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString();
      const tokenRes = await fetch(`${KROGER_ORIGIN}/v1/connect/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + basicAuth,
          "Accept-Encoding": "identity",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
      if (tokenJson && typeof tokenJson.access_token === "string") {
        tokenJson.access_token = (tokenJson.access_token as string).replace(/\s+/g, "").trim();
      }
      res.status(tokenRes.status).set("Content-Type", "application/json");
      res.end(JSON.stringify(tokenJson));
      return;
    } catch (err) {
      if (!res.headersSent) res.status(502).json(safeClientError(err, "Kroger token refresh failed."));
      return;
    }
  }

  const subPath = pathname.replace(/^\/kroger-api\/?/, "") || "";
  const pathWithSlash = subPath.startsWith("/") ? subPath : "/" + subPath;
  const query = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
  const url = `${KROGER_ORIGIN}${pathWithSlash}${query}`;

  try {
    const headers: HeadersInit = {
      "Content-Type": req.headers["content-type"] ?? "application/json",
      "Accept-Encoding": "identity",
    };
    const krogerAuth = await resolveKrogerProxyAuthorization(req);
    if (krogerAuth) {
      (headers as Record<string, string>)["Authorization"] = krogerAuth;
    }

    const options: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(30_000),
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as ArrayBuffer));
      }
      const body = Buffer.concat(chunks);
      if (body.length > 0) options.body = body;
    }

    const proxyRes = await fetch(url, options);
    const contentType = proxyRes.headers.get("content-type") ?? "application/json";
    res.status(proxyRes.status).set("Content-Type", contentType);
    const body = await proxyRes.arrayBuffer();
    res.end(Buffer.from(body));
    if (proxyRes.status >= 400) {
      logger.info(
        { method: req.method, url, status: proxyRes.status, hasKrogerAuth: !!krogerAuth },
        "Kroger proxy upstream error"
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && (err as Error & { cause?: unknown }).cause;
    const detail = cause instanceof Error ? cause.message : String(cause ?? "");
    logger.error({ err: message, detail, url }, "Kroger proxy fetch failed");
    if (!res.headersSent) {
      res.status(502).json(safeClientError(err, "Kroger API proxy failed."));
    }
  }
}
