import type { Request, Response } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { isProduction } from "../safeError.js";

const OLLAMA_ORIGIN = config.ollamaOrigin;

/**
 * Forward the request to local/remote Ollama. Pass `bodyOverride` when the body was parsed as JSON (e.g. POST /api/chat).
 */
export async function proxyOllamaRequest(
  req: Request,
  res: Response,
  bodyOverride?: Buffer
): Promise<void> {
  const subPath = req.path || "/";
  const query = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
  const url = `${OLLAMA_ORIGIN}${subPath}${query}`;

  try {
    const headers: HeadersInit = {
      "Content-Type": bodyOverride
        ? "application/json"
        : String(req.headers["content-type"] ?? "application/json"),
    };

    const proxyTimeoutMs = config.ollamaProxyTimeoutMs;
    const options: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(proxyTimeoutMs),
    };

    if (bodyOverride && bodyOverride.length) {
      options.body = new Uint8Array(bodyOverride);
    } else if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      req.body &&
      Buffer.isBuffer(req.body)
    ) {
      options.body = new Uint8Array(req.body);
    }

    const proxyRes = await fetch(url, options);

    const contentType = proxyRes.headers.get("content-type") ?? "application/json";
    res.status(proxyRes.status).set("Content-Type", contentType);

    if (proxyRes.body) {
      for await (const chunk of proxyRes.body) {
        res.write(Buffer.from(chunk));
      }
    }
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isConnectionError =
      typeof message === "string" &&
      (message.includes("ECONNREFUSED") ||
        message.includes("fetch failed") ||
        message.includes("Failed to fetch") ||
        message.includes("ENOTFOUND"));
    const hint = isConnectionError
      ? ` Cannot reach Ollama at ${OLLAMA_ORIGIN}. Set OLLAMA_ORIGIN (e.g. in ECS task env) or use Featherless (FEATHERLESS_API_KEY + LLM_PROVIDER=featherless).`
      : "";
    logger.warn({ err: message, url }, "Ollama proxy error");
    if (!res.headersSent) {
      const detail = isProduction ? "" : message + hint;
      res.status(502).json({
        error: "The meal generation service is temporarily unavailable.",
        ...(detail ? { error_description: detail } : {}),
      });
    }
  }
}
