import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { config } from "../config.js";
import { logger } from "../logger.js";

export type SubscriptionStatus = "none" | "active" | "past_due" | "canceled";

export interface UserRecord {
  userId: string;
  /** Cognito `email` claim when present on the token used for upsert. */
  email?: string;
  /** Cognito `username` (sign-in identifier; may differ from email). */
  username?: string;
  stripeCustomerId?: string;
  subscriptionStatus: SubscriptionStatus;
  updatedAt: string;
}

let docClient: DynamoDBDocumentClient | null = null;

function getDocClient(): DynamoDBDocumentClient | null {
  const table = config.dynamodbUsersTable;
  if (!table) return null;
  if (!docClient) {
    const client = new DynamoDBClient({ region: config.dynamodbRegion });
    docClient = DynamoDBDocumentClient.from(client);
  }
  return docClient;
}

export async function getUser(userId: string): Promise<UserRecord | null> {
  const d = getDocClient();
  const table = config.dynamodbUsersTable;
  if (!d || !table) return null;
  try {
    const out = await d.send(
      new GetCommand({ TableName: table, Key: { userId } })
    );
    return (out.Item as UserRecord | undefined) ?? null;
  } catch (e) {
    logger.error({ err: e, userId }, "DynamoDB getUser failed");
    return null;
  }
}

export async function putUser(record: UserRecord): Promise<void> {
  const d = getDocClient();
  const table = config.dynamodbUsersTable;
  if (!d || !table) {
    logger.warn("DYNAMODB_USERS_TABLE not set — user record not saved");
    return;
  }
  try {
    await d.send(
      new PutCommand({
        TableName: table,
        Item: { ...record, updatedAt: new Date().toISOString() },
      })
    );
  } catch (e) {
    logger.error({ err: e, userId: record.userId }, "DynamoDB putUser failed");
  }
}

export async function upsertUserFromAuth(
  userId: string,
  opts: { email?: string; username?: string }
): Promise<void> {
  const { email, username } = opts;
  const existing = await getUser(userId);
  if (existing) {
    const emailChanged = email !== undefined && email !== existing.email;
    const usernameChanged = username !== undefined && username !== existing.username;
    if (!emailChanged && !usernameChanged) return;

    const d = getDocClient();
    const table = config.dynamodbUsersTable;
    if (!d || !table) return;

    const setParts: string[] = ["updatedAt = :u"];
    const vals: Record<string, string> = { ":u": new Date().toISOString() };
    if (emailChanged) {
      setParts.push("email = :e");
      vals[":e"] = email;
    }
    if (usernameChanged) {
      setParts.push("username = :n");
      vals[":n"] = username;
    }

    try {
      await d.send(
        new UpdateCommand({
          TableName: table,
          Key: { userId },
          UpdateExpression: "SET " + setParts.join(", "),
          ExpressionAttributeValues: vals,
        })
      );
    } catch (e) {
      logger.error({ err: e, userId }, "DynamoDB upsertUserFromAuth update failed");
    }
    return;
  }

  await putUser({
    userId,
    email,
    username,
    subscriptionStatus: "none",
    updatedAt: new Date().toISOString(),
  });
}

export async function updateSubscriptionByStripe(
  userId: string,
  fields: {
    stripeCustomerId?: string;
    subscriptionStatus: SubscriptionStatus;
  }
): Promise<void> {
  const d = getDocClient();
  const table = config.dynamodbUsersTable;
  if (!d || !table) return;

  try {
    const existing = await getUser(userId);
    if (!existing) {
      await putUser({
        userId,
        stripeCustomerId: fields.stripeCustomerId,
        subscriptionStatus: fields.subscriptionStatus,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const expr: string[] = ["SET subscriptionStatus = :s", "updatedAt = :u"];
    const vals: Record<string, string> = {
      ":s": fields.subscriptionStatus,
      ":u": new Date().toISOString(),
    };
    if (fields.stripeCustomerId) {
      expr.push("stripeCustomerId = :c");
      vals[":c"] = fields.stripeCustomerId;
    }

    await d.send(
      new UpdateCommand({
        TableName: table,
        Key: { userId },
        UpdateExpression: expr.join(", "),
        ExpressionAttributeValues: vals,
      })
    );
  } catch (e) {
    logger.error({ err: e, userId }, "DynamoDB updateSubscriptionByStripe failed");
  }
}

/** After checkout.session.completed — link Stripe customer to Cognito user. */
export async function ensureUserForStripe(
  userId: string,
  stripeCustomerId: string,
  status: SubscriptionStatus
): Promise<void> {
  await updateSubscriptionByStripe(userId, { stripeCustomerId, subscriptionStatus: status });
}

/** Paginated scan for admin UI (newest `updatedAt` first within each page). */
export async function scanUsersForAdmin(opts: {
  limit: number;
  nextKey?: string;
}): Promise<{ users: UserRecord[]; nextToken: string | null }> {
  const d = getDocClient();
  const table = config.dynamodbUsersTable;
  if (!d || !table) {
    throw new Error("users_table_not_configured");
  }

  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (opts.nextKey) {
    try {
      const raw = Buffer.from(opts.nextKey, "base64url").toString("utf8");
      exclusiveStartKey = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      exclusiveStartKey = undefined;
    }
  }

  const limit = Math.min(Math.max(Math.floor(opts.limit), 1), 500);
  const out = await d.send(
    new ScanCommand({
      TableName: table,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    })
  );

  const users = (out.Items ?? []) as UserRecord[];
  users.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  let nextToken: string | null = null;
  if (out.LastEvaluatedKey && Object.keys(out.LastEvaluatedKey).length) {
    nextToken = Buffer.from(JSON.stringify(out.LastEvaluatedKey), "utf8").toString("base64url");
  }

  return { users, nextToken };
}
