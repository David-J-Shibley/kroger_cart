/**
 * Emit deploy-config.json for Docker/CI from environment variables.
 * Run: node scripts/write-deploy-config.mjs
 * Writes to DEPLOY_CONFIG_OUT or ../deploy-config.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const out = process.env.DEPLOY_CONFIG_OUT || path.join(root, "deploy-config.json");

const llmProxyRaw = (process.env.DEPLOY_LLM_PROXY_PREFIX || "").trim().replace(/\/$/, "");
const llmProxyPrefix =
  llmProxyRaw && llmProxyRaw.startsWith("/")
    ? llmProxyRaw
    : llmProxyRaw
      ? "/" + llmProxyRaw.replace(/^\/+/, "")
      : "/llm-api";

const j = {
  apiOrigin: (process.env.DEPLOY_API_ORIGIN || "").trim(),
  krogerClientId: (process.env.KROGER_CLIENT_ID || "").trim(),
  krogerRedirectUri: (process.env.DEPLOY_KROGER_REDIRECT_URI || process.env.KROGER_REDIRECT_URI || "").trim(),
  krogerLocationId: (process.env.KROGER_LOCATION_ID || "").trim(),
  llmModel: (
    process.env.LLM_MODEL ||
    process.env.FEATHERLESS_MODEL ||
    "Qwen/Qwen2.5-7B-Instruct"
  ).trim(),
  llmModels: (() => {
    const primary = (
      process.env.LLM_MODEL ||
      process.env.FEATHERLESS_MODEL ||
      "Qwen/Qwen2.5-7B-Instruct"
    ).trim();
    const raw = (process.env.DEPLOY_LLM_MODELS || "").trim();
    if (!raw) return [primary];
    const parts = raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const p of parts) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out.length > 0 ? out : [primary];
  })(),
  llmProxyPrefix,
  cognitoDomain: (process.env.COGNITO_DOMAIN || "").trim().replace(/^https:\/\//i, "").replace(/\/+$/, ""),
  cognitoClientId: (process.env.COGNITO_CLIENT_ID || "").split(",")[0]?.trim() || "",
  cognitoRedirectUri: (process.env.COGNITO_AUTH_CALLBACK_URL || process.env.DEPLOY_COGNITO_REDIRECT_URI || "").trim(),
  authRequired: /^(1|true|yes|on)$/i.test((process.env.AUTH_REQUIRED || "").trim()),
  authAllowAnonymousBrowsing: /^(1|true|yes|on)$/i.test(
    (process.env.AUTH_ALLOW_ANONYMOUS_BROWSING || "").trim()
  ),
  subscriptionRequired: /^(1|true|yes|on)$/i.test((process.env.SUBSCRIPTION_REQUIRED || "").trim()),
  cookieSessionAuth: /^(1|true|yes|on)$/i.test((process.env.COOKIE_APP_SESSION || "").trim()),
  testMode: /^(1|true|yes|on)$/i.test((process.env.TEST || "").trim()),
};

fs.writeFileSync(out, JSON.stringify(j, null, 2) + "\n", "utf8");
console.log("Wrote", out);
