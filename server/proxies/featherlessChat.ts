import type { Request, Response } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { safeClientError } from "../safeError.js";

type LlmChatBody = {
  model?: string;
  messages?: unknown;
  stream?: boolean;
  options?: { num_predict?: number };
};

function contentFromParts(c: unknown): string {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  let out = "";
  for (const part of c) {
    if (part && typeof part === "object") {
      const t = (part as { text?: string }).text;
      if (typeof t === "string") out += t;
    }
  }
  return out;
}

/** Token deltas from streaming chunks (`delta.content`). */
function extractDeltaText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";
  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const delta = (choices[0] as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") return "";
  return contentFromParts((delta as { content?: unknown }).content);
}

/**
 * Any assistant text in an OpenAI-style chunk: streaming deltas, final `message`, or legacy `text`.
 */
function extractAnyAssistantText(chunk: unknown): string {
  const fromDelta = extractDeltaText(chunk);
  if (fromDelta) return fromDelta;
  if (!chunk || typeof chunk !== "object") return "";
  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const ch0 = choices[0] as {
    message?: { content?: unknown };
    text?: unknown;
  };
  const mc = contentFromParts(ch0.message?.content);
  if (mc) return mc;
  if (typeof ch0.text === "string") return ch0.text;
  return "";
}

function isDataLine(trimmed: string): boolean {
  return /^data:\s*/i.test(trimmed);
}

function dataPayload(trimmed: string): string {
  return trimmed.replace(/^data:\s*/i, "").trim();
}

/** Single JSON completion body (some gateways return this even when stream was requested). */
function tryParseFullCompletionJson(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith("{")) return "";
  try {
    const j = JSON.parse(t) as { choices?: Array<{ message?: { content?: string } }> };
    const c = j.choices?.[0]?.message?.content;
    return typeof c === "string" ? c : "";
  } catch {
    return "";
  }
}

/**
 * POST /api/chat — call Featherless OpenAI-compatible API and stream NDJSON chunks the browser parses (newline JSON with message.content).
 * @see https://featherless.ai/docs/overview
 */
export async function handleFeatherlessChat(req: Request, res: Response): Promise<void> {
  if (!config.featherlessApiKey?.trim()) {
    logger.warn("featherless_chat_blocked: FEATHERLESS_API_KEY missing — upstream never called");
    res.status(503).json({
      error: "FEATHERLESS_API_KEY is not set — meal generation is disabled.",
    });
    return;
  }

  const body = req.body as LlmChatBody;
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : config.llmModel;
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "Invalid request: messages must be an array" });
    return;
  }

  logger.info(
    { model, messageCount: messages.length },
    "featherless_chat_accepted — calling upstream"
  );

  const stream = body.stream !== false;
  const numPredict = body.options?.num_predict;
  const maxTokens =
    typeof numPredict === "number" && Number.isFinite(numPredict)
      ? Math.min(8192, Math.max(64, Math.round(numPredict)))
      : 2048;

  const url = `${config.featherlessApiBase}/chat/completions`;
  const timeoutMs = config.llmUpstreamTimeoutMs;

  console.log("trying to fetch", url, timeoutMs);
  try {
    logger.info({ upstreamBase: config.featherlessApiBase }, "featherless_upstream_fetch_start");
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

    console.log("upstream", upstream);
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
    let forwardedPieces = 0;
    let accumulatedRaw = "";

    const forwardPiece = (piece: string): void => {
      if (!piece) return;
      forwardedPieces += 1;
      res.write(
        JSON.stringify({
          model,
          message: { role: "assistant", content: piece },
          done: false,
        }) + "\n"
      );
    };

    const processSseLine = (line: string): void => {
      const trimmed = line.replace(/\r$/, "").trim();
      if (!trimmed || !isDataLine(trimmed)) return;
      const payload = dataPayload(trimmed);
      if (payload === "[DONE]") return;
      try {
        const chunk = JSON.parse(payload) as unknown;
        const piece = extractAnyAssistantText(chunk);
        if (piece.length > 0) forwardPiece(piece);
      } catch {
        /* ignore malformed SSE JSON */
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });
        accumulatedRaw += chunkText;
        sseBuffer += chunkText;
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";

        for (const line of lines) {
          processSseLine(line);
        }
      }
    } finally {
      reader.releaseLock?.();
    }

    /** Trailing `data: {...}` often has no final newline — was dropped from the stream parser. */
    for (const line of sseBuffer.split("\n")) {
      processSseLine(line);
    }

    if (forwardedPieces === 0) {
      const asFull = tryParseFullCompletionJson(accumulatedRaw);
      if (asFull) {
        forwardPiece(asFull);
      }
    }

    /** Raw NDJSON lines (no `data:` SSE wrapper) — some proxies emit this. */
    if (forwardedPieces === 0) {
      for (const line of accumulatedRaw.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          const piece = extractAnyAssistantText(JSON.parse(t) as unknown);
          if (piece.length > 0) forwardPiece(piece);
        } catch {
          /* not JSON */
        }
      }
    }

    if (forwardedPieces === 0) {
      logger.warn(
        { model, rawHead: accumulatedRaw.slice(0, 400) },
        "Featherless stream had no forwardable text; trying non-stream completion"
      );
      try {
        const retry = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.featherlessApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            max_tokens: maxTokens,
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(Math.min(timeoutMs, 180_000)),
        });
        if (retry.ok) {
          const j = (await retry.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = j.choices?.[0]?.message?.content ?? "";
          if (typeof content === "string" && content.length > 0) {
            forwardPiece(content);
          }
        } else {
          const errText = await retry.text();
          logger.warn({ status: retry.status, body: errText.slice(0, 500) }, "Featherless non-stream retry failed");
        }
      } catch (e) {
        logger.warn({ err: e instanceof Error ? e.message : e }, "Featherless non-stream retry error");
      }
    }

    if (forwardedPieces === 0) {
      logger.warn({ model }, "Featherless returned no assistant content — check model id and API key/plan");
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
