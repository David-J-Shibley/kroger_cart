import express, { type Request, type Response } from "express";
import { config } from "../config.js";
import { handleFeatherlessChat } from "./featherlessChat.js";
import { proxyOllamaRequest } from "./ollamaForward.js";

function setOllamaCors(res: Response): void {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export const llmProxyRouter = express.Router();

llmProxyRouter.use((req: Request, res: Response, next: express.NextFunction) => {
  if (req.method === "OPTIONS") {
    setOllamaCors(res);
    res.sendStatus(204);
    return;
  }
  next();
});

const chatJson = express.json({ limit: "2mb" });

llmProxyRouter.post("/api/chat", chatJson, async (req: Request, res: Response) => {
  setOllamaCors(res);
  if (config.llmProvider === "featherless") {
    await handleFeatherlessChat(req, res);
    return;
  }
  const buf = Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
  await proxyOllamaRequest(req, res, buf);
});

/** Other Ollama paths (e.g. /api/tags) — raw forward when using Ollama. */
llmProxyRouter.use(express.raw({ type: "*/*" }), async (req: Request, res: Response) => {
  setOllamaCors(res);
  if (config.llmProvider === "featherless") {
    res.status(404).json({
      error: "Only POST /ollama-api/api/chat is supported when LLM_PROVIDER=featherless.",
    });
    return;
  }
  await proxyOllamaRequest(req, res);
});
