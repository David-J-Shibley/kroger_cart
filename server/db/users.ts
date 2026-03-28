import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { config } from "../config.js";
import { logger } from "../logger.js";

export type SubscriptionStatus = "none" | "active" | "past_due" | "canceled";

export interface UserRecord {
  userId: string;
  email?: string;
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

export async function upsertUserFromAuth(userId: string, email?: string): Promise<void> {
  const existing = await getUser(userId);
  if (existing) {
    if (email && email !== existing.email) {
      const d = getDocClient();
      const table = config.dynamodbUsersTable;
      if (d && table) {
        try {
          await d.send(
            new UpdateCommand({
              TableName: table,
              Key: { userId },
              UpdateExpression: "SET email = :e, updatedAt = :u",
              ExpressionAttributeValues: {
                ":e": email,
                ":u": new Date().toISOString(),
              },
            })
          );
        } catch (e) {
          logger.error({ err: e, userId }, "DynamoDB upsertUserFromAuth email update failed");
        }
      }
    }
    return;
  }
  await putUser({
    userId,
    email,
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
