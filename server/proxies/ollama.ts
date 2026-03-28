import express, { type Request, type Response } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";

const OLLAMA_ORIGIN = config.ollamaOrigin;

export const ollamaProxyRouter = express.Router();

ollamaProxyRouter.use(express.raw({ type: "*/*" }));

ollamaProxyRouter.use(async (req: Request, res: Response): Promise<void> => {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(204);
    return;
  }

  const subPath = req.path || "/";
  const query = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
  const url = `${OLLAMA_ORIGIN}${subPath}${query}`;

  try {
    const headers: HeadersInit = {
      "Content-Type": req.headers["content-type"] ?? "application/json",
    };

    const proxyTimeoutMs = config.ollamaProxyTimeoutMs;
    const options: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(proxyTimeoutMs),
    };

    if (req.method !== "GET" && req.method !== "HEAD" && req.body && Buffer.isBuffer(req.body)) {
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
      ? ` Cannot reach Ollama at ${OLLAMA_ORIGIN}. Set OLLAMA_ORIGIN (e.g. in ECS task env).`
      : "";
    logger.warn({ err: message, url }, "Ollama proxy error");
    res.status(502).json({ error: message + hint });
  }
});
