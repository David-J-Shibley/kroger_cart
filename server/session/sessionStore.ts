import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { APP_SESSION_TTL_BUFFER_DAYS } from "./constants.js";

export interface SessionRow {
  sessionId: string;
  sealed: string;
  /** Unix seconds — DynamoDB TTL attribute if enabled on table */
  ttl?: number;
  updatedAt: string;
}

let doc: DynamoDBDocumentClient | null = null;

function getDoc(): DynamoDBDocumentClient | null {
  const table = config.dynamodbSessionsTable.trim();
  if (!table) return null;
  if (!doc) {
    doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.dynamodbRegion }));
  }
  return doc;
}

export async function putSessionRow(row: SessionRow): Promise<void> {
  const d = getDoc();
  const table = config.dynamodbSessionsTable.trim();
  if (!d || !table) throw new Error("sessions_table_missing");
  const ttlSec = Math.floor(Date.now() / 1000) + APP_SESSION_TTL_BUFFER_DAYS * 24 * 60 * 60;
  await d.send(
    new PutCommand({
      TableName: table,
      Item: {
        sessionId: row.sessionId,
        sealed: row.sealed,
        ttl: ttlSec,
        updatedAt: row.updatedAt,
      },
    })
  );
}

export async function getSessionRow(sessionId: string): Promise<SessionRow | null> {
  const d = getDoc();
  const table = config.dynamodbSessionsTable.trim();
  if (!d || !table) return null;
  try {
    const out = await d.send(
      new GetCommand({ TableName: table, Key: { sessionId } })
    );
    const it = out.Item as Record<string, unknown> | undefined;
    if (!it || typeof it.sealed !== "string") return null;
    return {
      sessionId,
      sealed: it.sealed,
      updatedAt: typeof it.updatedAt === "string" ? it.updatedAt : "",
    };
  } catch (e) {
    logger.error({ err: e, sessionId }, "getSessionRow failed");
    return null;
  }
}

export async function deleteSessionRow(sessionId: string): Promise<void> {
  const d = getDoc();
  const table = config.dynamodbSessionsTable.trim();
  if (!d || !table) return;
  try {
    await d.send(
      new DeleteCommand({
        TableName: table,
        Key: { sessionId },
      })
    );
  } catch (e) {
    logger.warn({ err: e, sessionId }, "deleteSessionRow failed");
  }
}
