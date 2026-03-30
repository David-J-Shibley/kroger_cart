import type { Request, Response } from "express";
import { config } from "../config.js";
import { clearKrogerInCookieSession } from "../session/krogerSession.js";

/** Unlink Kroger from the server-side app session (cookie mode). */
export async function deleteKrogerSessionHandler(req: Request, res: Response): Promise<void> {
  if (!config.cookieAppSessionEnabled) {
    res.status(204).end();
    return;
  }
  await clearKrogerInCookieSession(req);
  res.status(204).end();
}
