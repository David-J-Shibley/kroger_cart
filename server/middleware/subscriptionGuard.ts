import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { getUser } from "../db/users.js";
import { logger } from "../logger.js";

/**
 * After cognitoAuthMiddleware: block if subscription not active (when enabled).
 */
export async function subscriptionGuardMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  if (!config.subscriptionRequired) {
    next();
    return;
  }

  if (!config.dynamodbUsersTable) {
    logger.error("SUBSCRIPTION_REQUIRED=true but DYNAMODB_USERS_TABLE is not set");
    res.status(503).json({
      error: "server_misconfiguration",
      error_description: "Subscription checks require DYNAMODB_USERS_TABLE.",
    });
    return;
  }

  const sub = req.appUserId;
  if (!sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await getUser(sub);
  if (user?.subscriptionStatus === "active") {
    next();
    return;
  }

  res.status(403).json({
    error: "subscription_required",
    error_description:
      "An active subscription is required. Click Subscribe in the header to choose a plan.",
  });
}
