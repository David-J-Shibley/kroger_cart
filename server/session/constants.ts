/** HttpOnly session cookie — value is opaque id; tokens live in DynamoDB (encrypted). */
export const APP_SESSION_COOKIE_NAME = "gg_app_s";

/** Browser cookie lifetime (refresh token may allow longer server-side renewal). */
export const APP_SESSION_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30;

/** DynamoDB TTL attribute (epoch seconds) — slightly after cookie. */
export const APP_SESSION_TTL_BUFFER_DAYS = 35;
