import type { Request, Response } from "express";
import { isAdminRequest } from "../adminAccess.js";
import { config } from "../config.js";
import { scanUsersForAdmin } from "../db/users.js";
import { logger } from "../logger.js";
import { scanFeedbackItems } from "./feedback.js";

export function getAdminStatus(req: Request, res: Response): void {
  if (!config.authRequired) {
    res.json({ admin: false });
    return;
  }
  if (!req.appUserId) {
    res.status(401).json({ error: "Unauthorized", admin: false });
    return;
  }
  const admin = isAdminRequest(req);
  res.json({
    admin,
    ...(admin
      ? {
          usersTableConfigured: Boolean(config.dynamodbUsersTable?.trim()),
          feedbackTableConfigured: Boolean(config.feedbackTable.trim()),
          dynamodbRegion: config.dynamodbRegion,
          usersTableName: config.dynamodbUsersTable?.trim() || null,
        }
      : {}),
  });
}

export async function getAdminFeedback(req: Request, res: Response): Promise<void> {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Forbidden", error_description: "Admin access only." });
    return;
  }
  if (!config.feedbackTable.trim()) {
    res.status(503).json({ error: "FEEDBACK_TABLE is not configured." });
    return;
  }
  const raw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 100;
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 500) : 100;
  try {
    const items = await scanFeedbackItems(limit);
    res.json({ items });
  } catch (e) {
    logger.error({ err: e }, "admin feedback list failed");
    res.status(502).json({ error: "Could not load feedback from DynamoDB." });
  }
}

export async function getAdminUsers(req: Request, res: Response): Promise<void> {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Forbidden", error_description: "Admin access only." });
    return;
  }
  if (!config.dynamodbUsersTable?.trim()) {
    res.status(503).json({ error: "DYNAMODB_USERS_TABLE is not configured." });
    return;
  }

  const rawLimit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 200;
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;
  const nextKey = typeof req.query.next === "string" && req.query.next.trim() ? req.query.next.trim() : undefined;

  try {
    const { users, nextToken } = await scanUsersForAdmin({ limit, nextKey });
    const countsThisPage: Record<string, number> = {};
    for (const u of users) {
      const s = u.subscriptionStatus || "none";
      countsThisPage[s] = (countsThisPage[s] || 0) + 1;
    }
    res.json({
      users,
      next: nextToken,
      countsThisPage,
      pageSize: users.length,
    });
  } catch (e) {
    logger.error({ err: e }, "admin users list failed");
    res.status(502).json({ error: "Could not load users from DynamoDB." });
  }
}
