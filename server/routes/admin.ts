import type { Request, Response } from "express";
import { isAdminRequest } from "../adminAccess.js";
import { config } from "../config.js";
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
  res.json({ admin: isAdminRequest(req) });
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
