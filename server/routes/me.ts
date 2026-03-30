import type { Request, Response } from "express";
import { config } from "../config.js";
import { upsertUserFromAuth, getUser } from "../db/users.js";
import { krogerLinkedFromCookieSession } from "../session/krogerSession.js";

export async function getMe(req: Request, res: Response): Promise<void> {
  const userId = req.appUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await upsertUserFromAuth(userId, {
    email: req.appUserEmail,
    username: req.appUsername,
  });
  const user = await getUser(userId);
  const krogerLinked =
    config.cookieAppSessionEnabled && (await krogerLinkedFromCookieSession(req));
  res.json({
    userId,
    email: user?.email ?? req.appUserEmail ?? null,
    username: user?.username ?? req.appUsername ?? null,
    subscriptionStatus: user?.subscriptionStatus ?? "none",
    stripeCustomerId: user?.stripeCustomerId ?? null,
    krogerLinked,
    /** Same as GET /api/health — helps the UI detect deploy-config vs server env mismatch. */
    llmProvider: config.llmProvider,
  });
}
