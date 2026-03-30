import type { Request, Response } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { safeClientError } from "../safeError.js";

type OllamaStyleBody = {
  model?: string;
  messages?: unknown;
  stream?: boolean;
  options?: { num_predict?: number };
};

/**
 * POST /api/chat — call Featherless OpenAI-compatible API and stream NDJSON chunks the browser client already parses (Ollama-shaped).
 * @see https://featherless.ai/docs/overview
 */
export async function handleFeatherlessChat(req: Request, res: Response): Promise<void> {
  if (!config.featherlessApiKey) {
    res.status(503).json({
      error: "LLM_PROVIDER is featherless but FEATHERLESS_API_KEY is not set.",
    });
    return;
  }

  const body = req.body as OllamaStyleBody;
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : config.llmModel;
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "Invalid request: messages must be an array" });
    return;
  }

  const stream = body.stream !== false;
  const numPredict = body.options?.num_predict;
  const maxTokens =
    typeof numPredict === "number" && Number.isFinite(numPredict)
      ? Math.min(8192, Math.max(64, Math.round(numPredict)))
      : 2048;

  const url = `${config.featherlessApiBase}/chat/completions`;
  const timeoutMs = config.ollamaProxyTimeoutMs;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.featherlessApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        stream,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      logger.warn(
        { status: upstream.status, body: errText.slice(0, 500) },
        "Featherless chat error"
      );
      res.status(upstream.status).type("application/json").send(errText);
      return;
    }

    if (!stream) {
      const j = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = j.choices?.[0]?.message?.content ?? "";
      res.setHeader("Content-Type", "application/x-ndjson");
      res.write(
        JSON.stringify({
          model,
          message: { role: "assistant", content },
          done: true,
        }) + "\n"
      );
      res.end();
      return;
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    const reader = upstream.body?.getReader();
    if (!reader) {
      res.status(502).json({ error: "Empty stream from Featherless" });
      return;
    }

    const decoder = new TextDecoder();
    let sseBuffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string; role?: string } }>;
            };
            const piece = chunk.choices?.[0]?.delta?.content;
            if (typeof piece === "string" && piece.length > 0) {
              res.write(
                JSON.stringify({
                  model,
                  message: { role: "assistant", content: piece },
                  done: false,
                }) + "\n"
              );
            }
          } catch {
            /* ignore malformed SSE JSON */
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }

    res.write(JSON.stringify({ model, done: true }) + "\n");
    res.end();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, "Featherless fetch failed");
    if (!res.headersSent) {
      res
        .status(502)
        .json(
          safeClientError(
            err,
            "Meal generation is temporarily unavailable. Please try again later."
          )
        );
    }
  }
}
