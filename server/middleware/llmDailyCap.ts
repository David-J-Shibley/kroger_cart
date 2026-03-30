import type { NextFunction, Request, Response } from "express";
import { consumeLlmDailySlot } from "../llmUsage.js";

/** Per-user UTC daily cap on LLM proxy usage (Dynamo-backed). */
export async function llmDailyCapMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.method !== "POST") {
    next();
    return;
  }
  const uid = req.appUserId;
  if (!uid) {
    next();
    return;
  }
  const ok = await consumeLlmDailySlot(uid);
  if (!ok) {
    res.status(429).json({
      error: "Daily LLM request limit reached.",
      error_description: "Try again tomorrow or contact support if you need a higher limit.",
    });
    return;
  }
  next();
}
