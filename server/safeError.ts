/** Avoid leaking stack / driver messages to browsers in production. */
export const isProduction = process.env.NODE_ENV === "production";

export function safeClientError(
  err: unknown,
  fallback: string
): { error: string; error_description?: string } {
  if (!isProduction && err instanceof Error && err.message) {
    return { error: fallback, error_description: err.message };
  }
  return { error: fallback };
}
