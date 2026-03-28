import rateLimit from "express-rate-limit";
import type { Request } from "express";

function keyByUserOrIp(req: Request): string {
  const sub = req.appUserId;
  if (sub && sub !== "dev") return "u:" + sub;
  return "ip:" + (req.ip || req.socket.remoteAddress || "unknown");
}

/** Soft global cap (unauthenticated requests still hit public routes separately). */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || "500", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

export const proxyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_PROXY_MAX || "120", 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => keyByUserOrIp(req),
  message: { error: "Too many proxy requests" },
});

export const ollamaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_OLLAMA_MAX || "60", 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => keyByUserOrIp(req),
  message: { error: "LLM rate limit exceeded — try again later" },
});

export const authExchangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || "30", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts" },
});

/** Public product feedback — per IP. */
export const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_FEEDBACK_MAX || "20", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many feedback submissions — try again later." },
});
