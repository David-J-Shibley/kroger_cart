/**
 * Serves this directory and proxies Ollama API requests.
 * Run: npm start (or npx tsx server.ts), then open http://localhost:8000/kroger-cart.html
 */
import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OLLAMA_ORIGIN = process.env.OLLAMA_ORIGIN || "http://127.0.0.1:11434";
const PORT = parseInt(process.env.PORT || "8000", 10);

const app = express();

// Proxy: mount a router at /ollama-api so every subpath (e.g. /ollama-api/api/chat) is handled
const ollamaProxy = express.Router();

// Parse raw body for POST so we don't hang reading the stream; must be before the proxy handler
ollamaProxy.use(express.raw({ type: "*/*" }));

// router.use() with no path = runs for every request that reaches this router (any subpath)
ollamaProxy.use(async (req: Request, res: Response): Promise<void> => {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
    return;
  }

  // req.path is relative to router mount, so "/api/chat" for request /ollama-api/api/chat
  const subPath = req.path || "/";
  const query = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
  const url = `${OLLAMA_ORIGIN}${subPath}${query}`;

  try {
    const headers: HeadersInit = {
      "Content-Type": req.headers["content-type"] ?? "application/json",
    };

    // Timeout: long enough for full response (model load + generation can take 4+ min). Override with OLLAMA_PROXY_TIMEOUT_MS if needed.
    const proxyTimeoutMs = parseInt(process.env.OLLAMA_PROXY_TIMEOUT_MS || "600000", 10); // 10 min default
    const options: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(proxyTimeoutMs),
    };

    if (req.method !== "GET" && req.method !== "HEAD" && req.body && Buffer.isBuffer(req.body)) {
      options.body = req.body;
    }

    const proxyRes = await fetch(url, options);

    const contentType = proxyRes.headers.get("content-type") ?? "application/json";
    res.status(proxyRes.status).set("Content-Type", contentType);

    // Stream the body so the client sees output as Ollama generates it (no buffering)
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
      ? ` Cannot reach Ollama at ${OLLAMA_ORIGIN}. Is Ollama running? If the app is in Docker, set OLLAMA_ORIGIN to the host URL (e.g. host.docker.internal:11434 on Mac/Windows, or your host IP).`
      : "";
    res.status(502).json({ error: message + hint });
  }
});

app.use("/ollama-api", ollamaProxy);

// Proxy Kroger API to avoid CORS when adding to cart from the browser (single middleware so path always matches)
const KROGER_ORIGIN = "https://api.kroger.com";

app.use(async (req: Request, res: Response, next: () => void): Promise<void> => {
  const pathname = req.originalUrl?.split("?")[0] ?? req.path ?? "";
  if (!pathname.startsWith("/kroger-api")) {
    next();
    return;
  }

  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(204);
    return;
  }

  // Server-side token: server calls Kroger so the token is never corrupted by proxy response handling
  if (pathname === "/kroger-api/token" && req.method === "POST") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as ArrayBuffer));
      }
      const raw = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { clientId?: string; clientSecret?: string };
      const clientId = raw?.clientId ?? "";
      const clientSecret = raw?.clientSecret ?? "";
      const basicAuth = Buffer.from(clientId + ":" + clientSecret).toString("base64");
      const tokenRes = await fetch(`${KROGER_ORIGIN}/v1/connect/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + basicAuth,
          "Accept-Encoding": "identity",
        },
        body: "grant_type=client_credentials&scope=product.compact",
        signal: AbortSignal.timeout(15_000),
      });
      const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
      if (tokenJson && typeof tokenJson.access_token === "string") {
        tokenJson.access_token = (tokenJson.access_token as string).replace(/\s+/g, "").trim();
      }
      res.status(tokenRes.status).set("Content-Type", "application/json");
      res.end(JSON.stringify(tokenJson));
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
      return;
    }
  }

  // OAuth authorization code exchange (user login) for cart access
  if (pathname === "/kroger-api/oauth-exchange" && req.method === "POST") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as ArrayBuffer));
      }
      const raw = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        code?: string;
        redirectUri?: string;
        clientId?: string;
        clientSecret?: string;
      };
      const { code, redirectUri, clientId, clientSecret } = raw;
      if (!code || !redirectUri || !clientId || !clientSecret) {
        res.status(400).json({ error: "Missing code, redirectUri, clientId, or clientSecret" });
        return;
      }
      const basicAuth = Buffer.from(clientId + ":" + clientSecret).toString("base64");
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
      }).toString();
      const tokenRes = await fetch(`${KROGER_ORIGIN}/v1/connect/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + basicAuth,
          "Accept-Encoding": "identity",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
      if (tokenJson && typeof tokenJson.access_token === "string") {
        tokenJson.access_token = (tokenJson.access_token as string).replace(/\s+/g, "").trim();
      }
      res.status(tokenRes.status).set("Content-Type", "application/json");
      res.end(JSON.stringify(tokenJson));
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(502).json({ error: message });
      return;
    }
  }

  // OAuth refresh token exchange (get new access token without re-prompting user)
  if (pathname === "/kroger-api/oauth-refresh" && req.method === "POST") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as ArrayBuffer));
      }
      const raw = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        refreshToken?: string;
        clientId?: string;
        clientSecret?: string;
      };
      const { refreshToken, clientId, clientSecret } = raw;
      if (!refreshToken || !clientId || !clientSecret) {
        res.status(400).json({ error: "Missing refreshToken, clientId, or clientSecret" });
        return;
      }
      const basicAuth = Buffer.from(clientId + ":" + clientSecret).toString("base64");
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString();
      const tokenRes = await fetch(`${KROGER_ORIGIN}/v1/connect/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + basicAuth,
          "Accept-Encoding": "identity",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
      if (tokenJson && typeof tokenJson.access_token === "string") {
        tokenJson.access_token = (tokenJson.access_token as string).replace(/\s+/g, "").trim();
      }
      res.status(tokenRes.status).set("Content-Type", "application/json");
      res.end(JSON.stringify(tokenJson));
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(502).json({ error: message });
      return;
    }
  }

  const subPath = pathname.replace(/^\/kroger-api\/?/, "") || "";
  const pathWithSlash = subPath.startsWith("/") ? subPath : "/" + subPath;
  const query = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
  const url = `${KROGER_ORIGIN}${pathWithSlash}${query}`;

  try {
    const headers: HeadersInit = {
      "Content-Type": req.headers["content-type"] ?? "application/json",
      "Accept-Encoding": "identity",
    };
    const authRaw = req.headers["authorization"] || req.headers["Authorization"];
    if (authRaw) {
      const auth = typeof authRaw === "string" ? authRaw : (Array.isArray(authRaw) ? authRaw[0] : String(authRaw));
      const trimmed = auth.replace(/^\s*Bearer\s+/i, "").replace(/\s+/g, "").trim();
      if (trimmed) (headers as Record<string, string>)["Authorization"] = "Bearer " + trimmed;
    }

    const options: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(30_000),
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as ArrayBuffer));
      }
      const body = Buffer.concat(chunks);
      if (body.length > 0) options.body = body;
    }

    const proxyRes = await fetch(url, options);
    const contentType = proxyRes.headers.get("content-type") ?? "application/json";
    res.status(proxyRes.status).set("Content-Type", contentType);
    const body = await proxyRes.arrayBuffer();
    res.end(Buffer.from(body));
    if (proxyRes.status >= 400) {
      const hasAuth = !!(authRaw && (typeof authRaw === "string" ? authRaw : authRaw[0]));
      console.log("[Kroger proxy]", req.method, url, "->", proxyRes.status, "| Auth present:", hasAuth);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && (err as Error & { cause?: unknown }).cause;
    const detail = cause instanceof Error ? cause.message : String(cause ?? "");
    console.error("[Kroger proxy] fetch failed:", message, detail || "");
    if (!res.headersSent) {
      res.status(502).json({
        error: message,
        detail: detail || undefined,
        hint: "From the server machine, try: curl -s -o /dev/null -w '%{http_code}' https://api.kroger.com/v1/products",
      });
    }
  }
});

// Static files from project directory
app.use(express.static(__dirname));

// Bind to 0.0.0.0 so the server is reachable from outside the process (e.g. Docker, other hosts)
const host = process.env.HOST || "0.0.0.0";
app.listen(PORT, host, () => {
  console.log(`Serving at http://${host}:${PORT}/`);
  console.log(`Open http://localhost:${PORT}/kroger-cart.html`);
});
