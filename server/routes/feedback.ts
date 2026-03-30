import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Request, Response } from "express";
import { resolveCognitoBearerSub } from "../middleware/cognitoAuth.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const FEEDBACK_CATEGORIES = new Set(["suggestion", "complaint", "question", "other"]);

let feedbackDoc: DynamoDBDocumentClient | null = null;

function getFeedbackDb(): { client: DynamoDBDocumentClient; table: string } | null {
  const table = config.feedbackTable.trim();
  if (!table) return null;
  if (!feedbackDoc) {
    feedbackDoc = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: config.dynamodbRegion })
    );
  }
  return { client: feedbackDoc, table };
}

function sanitizeText(s: string, max: number): string {
  const stripped = s.replace(/\0/g, "").replace(/<[^>]*>/g, "").trim();
  return stripped.slice(0, max);
}

/**
 * Public endpoint — suggestions, complaints, questions (anonymous OK).
 * If the browser sends `Authorization: Bearer` (app Cognito access token), `userId` (Cognito `sub`) is stored in DynamoDB.
 * A present but invalid Bearer returns 401.
 */
export async function postFeedback(req: Request, res: Response): Promise<void> {
  const who = await resolveCognitoBearerSub(req);
  if (who.ok === false && who.reason === "invalid_token") {
    res.status(401).json({ error: "Invalid or expired sign-in. Remove Authorization or sign in again." });
    return;
  }
  if (who.ok === false && who.reason === "invalid_config") {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const hasBearer = typeof authHeader === "string" && /^Bearer\s+\S/i.test(authHeader);
    if (hasBearer) {
      res.status(503).json({ error: "Authentication is not configured on the server." });
      return;
    }
  }
  const userId = who.ok ? who.sub : undefined;

  const body = req.body as Record<string, unknown>;
  const rawMsg = typeof body.message === "string" ? body.message : "";
  const message = sanitizeText(rawMsg, 8000);
  if (message.length < 5) {
    res.status(400).json({ error: "Message must be at least 5 characters." });
    return;
  }

  const rawCat = typeof body.category === "string" ? body.category : "other";
  const category = FEEDBACK_CATEGORIES.has(rawCat) ? rawCat : "other";

  let contact = "";
  if (typeof body.contact === "string" && body.contact.trim()) {
    contact = sanitizeText(body.contact, 254);
    if (contact.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      res.status(400).json({ error: "If provided, contact should be a valid email." });
      return;
    }
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const userAgent = sanitizeText(
    typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "",
    512
  );

  logger.info(
    {
      event: "user_feedback",
      id,
      category,
      messageLength: message.length,
      hasContact: Boolean(contact),
      hasUserId: Boolean(userId),
      ip: req.ip,
    },
    "feedback received"
  );

  const db = getFeedbackDb();
  if (db) {
    try {
      await db.client.send(
        new PutCommand({
          TableName: db.table,
          Item: {
            id,
            createdAt,
            category,
            message,
            ...(userId ? { userId } : {}),
            ...(contact ? { contact } : {}),
            userAgent: userAgent || undefined,
          },
        })
      );
    } catch (e) {
      logger.error({ err: e, id }, "feedback DynamoDB put failed");
      res.status(503).json({
        error: "Could not save feedback right now. Please try again later or email support.",
      });
      return;
    }
  }

  res.status(201).json({ ok: true, id });
}

/** Admin: recent feedback rows (single Scan; fine for modest table sizes). */
export async function scanFeedbackItems(maxReturn: number): Promise<Record<string, unknown>[]> {
  const db = getFeedbackDb();
  if (!db) return [];
  const cap = Math.min(Math.max(maxReturn, 1), 500);
  const out = await db.client.send(
    new ScanCommand({
      TableName: db.table,
      Limit: 500,
    })
  );
  const items = [...(out.Items ?? [])] as Record<string, unknown>[];
  items.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  return items.slice(0, cap);
}
