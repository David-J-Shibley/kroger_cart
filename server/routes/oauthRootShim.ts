import type { Request, Response, NextFunction } from "express";

/**
 * Cognito sometimes returns to the site root if "Allowed callback URLs" is set to
 * https://localhost:8000/ instead of .../auth-callback.html. Forward OAuth params to the real page.
 */
export function oauthRootRedirectShim(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" || req.path !== "/") {
    next();
    return;
  }
  const q = req.query;
  const code = q.code;
  const oauthErr = q.error;
  if (typeof code !== "string" || !code.trim()) {
    if (typeof oauthErr !== "string" || !oauthErr.length) {
      next();
      return;
    }
  }
  const p = new URLSearchParams();
  for (const key of ["code", "state", "error", "error_description", "error_uri"]) {
    const v = q[key];
    if (typeof v === "string" && v.length) p.set(key, v);
  }
  res.redirect(302, `/auth-callback.html?${p.toString()}`);
}
