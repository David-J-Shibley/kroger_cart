import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

const allowedOrigins = new Set(
  config.browserCorsOrigins
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean)
);

/**
 * When the browser UI is hosted on a different origin than this API (e.g. Amplify + ECS),
 * set BROWSER_CORS_ORIGINS to a comma-separated list of allowed page origins so fetches
 * with Authorization are not blocked as cross-origin.
 */
export function browserCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (allowedOrigins.size === 0) {
    next();
    return;
  }
  const origin = req.get("Origin");
  const normalized = origin?.replace(/\/$/, "") ?? "";
  const ok = Boolean(origin && allowedOrigins.has(normalized));
  if (ok && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Kroger-Authorization"
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.status(ok ? 204 : 403).end();
    return;
  }
  next();
}
