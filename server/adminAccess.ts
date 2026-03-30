import type { Request } from "express";
import { getUser } from "./db/users.js";

/** Admin flag lives on the user row in DynamoDB (`isAdmin: true`). Set via console or migration — not self-service. */
export async function isUserAdmin(req: Request): Promise<boolean> {
  const id = req.appUserId?.trim();
  if (!id || id === "dev") return false;
  const u = await getUser(id);
  return Boolean(u?.isAdmin);
}
