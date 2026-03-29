import type { Request, Response } from "express";
import { upsertUserFromAuth, getUser } from "../db/users.js";

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
  res.json({
    userId,
    email: user?.email ?? req.appUserEmail ?? null,
    username: user?.username ?? req.appUsername ?? null,
    subscriptionStatus: user?.subscriptionStatus ?? "none",
    stripeCustomerId: user?.stripeCustomerId ?? null,
  });
}
