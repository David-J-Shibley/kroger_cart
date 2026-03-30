import "dotenv/config";
import express, { type Request } from "express";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { cognitoHostedUiDomainIssue, config, getKrogerCredentials } from "./config.js";
import { logger } from "./logger.js";
import { cognitoAuthMiddleware } from "./middleware/cognitoAuth.js";
import { llmDailyCapMiddleware } from "./middleware/llmDailyCap.js";
import { subscriptionGuardMiddleware } from "./middleware/subscriptionGuard.js";
import {
  authExchangeLimiter,
  feedbackLimiter,
  globalLimiter,
  ollamaLimiter,
  proxyLimiter,
} from "./middleware/rateLimits.js";
import { llmProxyRouter } from "./proxies/llmProxy.js";
import { krogerProxyMiddleware } from "./proxies/kroger.js";
import { stripeWebhookHandler } from "./routes/stripeWebhook.js";
import { deleteAppSessionHandler } from "./routes/appSession.js";
import { deleteKrogerSessionHandler } from "./routes/krogerSessionRoute.js";
import { postCognitoToken } from "./routes/cognitoToken.js";
import {
  getAdminFeedback,
  getAdminLlmMonitoring,
  getAdminStatus,
  getAdminUsers,
} from "./routes/admin.js";
import { getMe } from "./routes/me.js";
import {
  postBillingPortal,
  postCheckoutSession,
  postSyncCheckoutSession,
} from "./routes/billing.js";
import { oauthRootRedirectShim } from "./routes/oauthRootShim.js";
import { postFeedback } from "./routes/feedback.js";
import { browserCorsMiddleware } from "./middleware/browserCors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

export function createApp(): express.Express {
  const app = express();
  app.set("trust proxy", config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.use(browserCorsMiddleware);

  app.use((req, res, next) => {
    const start = Date.now();
    if (req.url === "/api/health") {
      next();
      return;
    }
    res.on("finish", () => {
      logger.info(
        { method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - start },
        "http_request"
      );
    });
    next();
  });

  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    stripeWebhookHandler
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, version: "1.0.0" });
  });

  const jsonBody = express.json({ limit: "100kb" });

  app.post("/api/auth/cognito-token", authExchangeLimiter, jsonBody, postCognitoToken);
  app.delete("/api/auth/session", deleteAppSessionHandler);

  app.use(globalLimiter);

  app.post("/api/feedback", feedbackLimiter, express.json({ limit: "32kb" }), postFeedback);

  const api = express.Router();
  api.use(jsonBody);
  api.use(cognitoAuthMiddleware);
  api.get("/me", getMe);
  api.delete("/kroger-session", deleteKrogerSessionHandler);
  api.get("/admin/status", getAdminStatus);
  api.get("/admin/llm-monitoring", getAdminLlmMonitoring);
  api.get("/admin/feedback", getAdminFeedback);
  api.get("/admin/users", getAdminUsers);
  api.post("/billing/checkout-session", postCheckoutSession);
  api.post("/billing/sync-checkout", postSyncCheckoutSession);
  api.post("/billing/portal", postBillingPortal);
  app.use("/api", api);

  app.use(
    "/ollama-api",
    cognitoAuthMiddleware,
    subscriptionGuardMiddleware,
    llmDailyCapMiddleware,
    ollamaLimiter,
    llmProxyRouter
  );

  app.use(
    "/kroger-api",
    proxyLimiter,
    cognitoAuthMiddleware,
    subscriptionGuardMiddleware,
    (req, res, next) => {
      void krogerProxyMiddleware(req, res, next);
    }
  );

  app.get("/", (req, res, next) => {
    oauthRootRedirectShim(req, res, () => {
      if (!config.authRequired) {
        next();
        return;
      }
      res.sendFile(path.join(rootDir, "landing.html"), (err) => {
        if (err) next(err);
      });
    });
  });
  app.use(express.static(rootDir));

  return app;
}

export function logStartupWarnings(): void {
  if (!getKrogerCredentials()) {
    logger.warn(
      "KROGER_CLIENT_ID / KROGER_CLIENT_SECRET not set — Kroger features will fail until configured."
    );
  }
  if (config.authRequired) {
    if (!config.cognitoUserPoolId || !config.cognitoClientId) {
      logger.warn("AUTH_REQUIRED but COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID incomplete.");
    }
    if (!config.cognitoDomain || !config.cognitoClientSecret) {
      logger.warn("AUTH_REQUIRED but COGNITO_DOMAIN / COGNITO_CLIENT_SECRET incomplete — login flow may fail.");
    }
    const cr = config.cognitoAuthCallbackUrl.trim().replace(/\/+$/, "");
    if (cr) {
      logger.info(
        { cognitoRedirectUri: cr },
        "Cognito Hosted UI: allow this exact URL under App client → Hosted UI → Allowed callback URLs (must match deploy-config.json cognitoRedirectUri when using split static/API hosting)."
      );
    }
  }
  const domainIssue = cognitoHostedUiDomainIssue(config.cognitoDomain);
  if (config.cognitoDomain && domainIssue) {
    logger.warn({ hint: domainIssue }, "COGNITO_DOMAIN is not a Cognito Hosted UI host — OAuth token/authorize calls will fail.");
  }
  const pubUrls = `${config.appPublicUrl} ${config.cognitoAuthCallbackUrl}`.toLowerCase();
  if (config.authRequired && pubUrls.includes("https://localhost")) {
    logger.warn(
      "Cognito callback uses https://localhost — this dev server speaks HTTP only unless you add TLS. Use http://localhost:<port>/auth-callback.html in Cognito Allowed callback URLs, or the browser cannot load the redirect."
    );
  }
  if (config.subscriptionRequired && !config.dynamodbUsersTable) {
    logger.warn("SUBSCRIPTION_REQUIRED=true but DYNAMODB_USERS_TABLE is not set.");
  }
  if (config.subscriptionRequired && (!config.stripeSecretKey || !config.stripePriceId)) {
    logger.warn("SUBSCRIPTION_REQUIRED=true but Stripe env vars are incomplete.");
  }
  if (config.llmProvider === "featherless" && !config.featherlessApiKey) {
    logger.warn(
      "LLM_PROVIDER=featherless (or FEATHERLESS_API_KEY implied) but FEATHERLESS_API_KEY is missing — meal generation will fail."
    );
  }
  if (config.cookieAppSessionMisconfigured) {
    logger.warn(
      "COOKIE_APP_SESSION=true but DYNAMODB_SESSIONS_TABLE and/or APP_SESSION_SECRET (min 16 chars) are missing — cookie sessions disabled; falling back to token JSON."
    );
  }
  logger.info(
    {
      trustProxy: config.trustProxy,
      llm: config.llmProvider,
      model: config.llmModel,
      llmDailyCapPerUser: config.llmDailyCapPerUser,
      ...(config.llmProvider === "ollama"
        ? { ollamaOrigin: config.ollamaOrigin }
        : { featherlessApiBase: config.featherlessApiBase }),
    },
    "LLM backend"
  );
}
