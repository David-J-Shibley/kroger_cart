import express, { type Request, type Response } from "express";
import { config } from "../config.js";
import { handleFeatherlessChat } from "./featherlessChat.js";

/**
 * CORS for LLM proxy. Do not overwrite `Access-Control-Allow-Origin` if `browserCorsMiddleware`
 * already set it (Amplify UI + API on another host + cookies) — `*` is invalid with credentials.
 */
function setLlmCors(res: Response): void {
  if (!res.getHeader("Access-Control-Allow-Origin")) {
    res.set("Access-Control-Allow-Origin", "*");
  }
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Cognito-Id-Token");
}

export const llmProxyRouter = express.Router();

llmProxyRouter.use((req: Request, res: Response, next: express.NextFunction) => {
  console.log("llmProxyRouter", req.method, req.url);
  if (req.method === "OPTIONS") {
    setLlmCors(res);
    res.sendStatus(204);
    return;
  }
  next();
});

const chatJson = express.json({ limit: config.llmChatJsonLimit });

llmProxyRouter.post("/api/chat", chatJson, async (req: Request, res: Response) => {
  setLlmCors(res);
  await handleFeatherlessChat(req, res);
});

/** Only streaming chat is supported — other paths 404. */
llmProxyRouter.use((_req: Request, res: Response) => {
  setLlmCors(res);
  res.status(404).json({
    error: "Only POST {prefix}/api/chat is supported for meal generation (prefix is /llm-api by default).",
  });
});
