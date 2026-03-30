import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "./config.js";
import { getUser, type UserRecord } from "./db/users.js";
import { logger } from "./logger.js";

const denialRing: { at: string; userId: string; reason: string }[] = [];
const RING_MAX = 200;

export function recordLlmDenial(userId: string, reason: string): void {
  denialRing.unshift({
    at: new Date().toISOString(),
    userId,
    reason,
  });
  if (denialRing.length > RING_MAX) denialRing.length = RING_MAX;
  logger.warn({ userId, reason }, "llm_daily_cap_denied");
}

export function getRecentLlmDenials(limit = 50): { at: string; userId: string; reason: string }[] {
  return denialRing.slice(0, Math.min(limit, RING_MAX));
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

let doc: DynamoDBDocumentClient | null = null;

function getDoc(): DynamoDBDocumentClient | null {
  const table = config.dynamodbUsersTable?.trim();
  if (!table) return null;
  if (!doc) {
    doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.dynamodbRegion }));
  }
  return doc;
}

/**
 * Reserves one LLM request for today against the per-user cap. Returns false if over cap.
 */
export async function consumeLlmDailySlot(userId: string): Promise<boolean> {
  if (!userId || userId === "dev") return true;
  const cap = config.llmDailyCapPerUser;
  if (cap <= 0) return true;

  const today = utcDay();
  const d = getDoc();
  const table = config.dynamodbUsersTable?.trim();
  if (!d || !table) {
    return true;
  }

  let u: UserRecord | null = await getUser(userId);
  let day = u?.llmUsageDay ?? "";
  let count = u?.llmUsageCount ?? 0;
  if (day !== today) {
    day = today;
    count = 0;
  }
  if (count >= cap) {
    recordLlmDenial(userId, "daily_cap");
    return false;
  }

  const nextCount = count + 1;
  try {
    await d.send(
      new UpdateCommand({
        TableName: table,
        Key: { userId },
        UpdateExpression: "SET llmUsageDay = :d, llmUsageCount = :c, updatedAt = :u",
        ExpressionAttributeValues: {
          ":d": today,
          ":c": nextCount,
          ":u": new Date().toISOString(),
        },
      })
    );
    return true;
  } catch (e) {
    logger.error({ err: e, userId }, "llm usage update failed — allowing request");
    return true;
  }
}
