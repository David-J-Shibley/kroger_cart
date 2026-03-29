import "express";

declare global {
  namespace Express {
    interface Request {
      /** Cognito `sub` (set by cognitoAuthMiddleware) */
      appUserId?: string;
      /** Cognito `username` claim when present */
      appUsername?: string;
      /** Cognito `email` claim only (not the username) */
      appUserEmail?: string;
    }
  }
}

export {};
