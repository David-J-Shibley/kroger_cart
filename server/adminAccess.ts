import type { Request } from "express";

function parseAdminCsv(envValue: string, fallback: string): string[] {
  const raw = envValue.trim() || fallback;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Lowercased Cognito usernames allowed to use /admin and /api/admin/*. */
export function getAdminUsernames(): string[] {
  return parseAdminCsv(process.env.ADMIN_USERNAMES ?? "", "dshibley");
}

/** Lowercased emails allowed (must contain @). */
export function getAdminEmails(): string[] {
  return parseAdminCsv(process.env.ADMIN_EMAILS ?? "", "davidjshibley@gmail.com");
}

export function isAdminRequest(req: Request): boolean {
  const username = (req.appUsername || "").trim().toLowerCase();
  const emailish = (req.appUserEmail || "").trim().toLowerCase();
  const allowedUsers = getAdminUsernames();
  const allowedEmails = getAdminEmails();

  if (username && allowedUsers.includes(username)) return true;
  if (emailish && !emailish.includes("@") && allowedUsers.includes(emailish)) return true;
  if (emailish.includes("@") && allowedEmails.includes(emailish)) return true;
  return false;
}
