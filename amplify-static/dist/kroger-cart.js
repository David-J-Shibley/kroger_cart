// client/app-state.ts
var appState = {
  accessToken: null,
  lastGeneratedText: ""
};
function loadStoredKrogerAppToken() {
  appState.accessToken = localStorage.getItem("krogerToken");
}

// client/auth-session.ts
var ACCESS_KEY = "appCognitoAccessToken";
var REFRESH_KEY = "appCognitoRefreshToken";
var ID_KEY = "appCognitoIdToken";
function getCognitoAccessToken() {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}
function getCognitoIdToken() {
  try {
    return localStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}
function clearCognitoSession() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(ID_KEY);
}

// client/config.ts
var SAVED_LLM_KEY = "krogerCartSavedLLM";
var SAVED_LLM_MODEL_KEY = "krogerCartLlmModel";
var SAVED_KROGER_LOCATION_ID_KEY = "krogerCartKrogerLocationId";
var SAVED_MEAL_PREFS_KEY = "krogerCartMealPrefs";
var AUTO_ADD_ENABLED_KEY = "krogerCartAutoAddEnabled";
var AUTO_ADD_STRATEGY_KEY = "krogerCartAutoAddStrategy";

// client/public-config.ts
var DEFAULT_LLM_MODEL = "Qwen/Qwen2.5-7B-Instruct";
function parseLlmModelsRaw(raw) {
  const seen = /* @__PURE__ */ new Set();
  const add = (s) => {
    const t = s.trim();
    if (t) seen.add(t);
  };
  if (Array.isArray(raw)) {
    for (const x of raw) add(String(x));
  } else if (typeof raw === "string") {
    for (const part of raw.split(/[,;\n]/)) add(part);
  }
  return [...seen];
}
function resolveLlmModelOptions(rawList, baseModel) {
  let list = parseLlmModelsRaw(rawList);
  if (list.length === 0) return [];
  if (!list.includes(baseModel)) list = [baseModel, ...list];
  return list;
}
var cached = null;
var backendOriginCache = null;
var LEGACY_BROWSER_SECRET_KEYS = [
  "appCognitoAccessToken",
  "appCognitoRefreshToken",
  "appCognitoIdToken",
  "krogerUserToken",
  "krogerUserTokenExpiry",
  "krogerUserRefreshToken"
];
function clearLegacyBrowserSecretsIfCookieSession(cookieSessionAuth) {
  if (!cookieSessionAuth || typeof window === "undefined") return;
  try {
    for (const k of LEGACY_BROWSER_SECRET_KEYS) {
      localStorage.removeItem(k);
    }
  } catch {
  }
}
function pageOrigin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}
function normalizeApiOrigin(apiRaw, pageOriginFallback) {
  let s = apiRaw.trim().replace(/\/$/, "");
  if (!s) return pageOriginFallback || "";
  if (/^https?:\/\//i.test(s)) return s;
  const lower = s.toLowerCase();
  const scheme = lower.startsWith("localhost") || lower.startsWith("127.0.0.1") || lower.startsWith("[::1]") ? "http://" : "https://";
  return scheme + s.replace(/^\/+/, "");
}
function normalizeCognitoDomain(raw) {
  let s = String(raw).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  return s;
}
async function loadDeployConfig() {
  if (cached) return cached;
  const origin = pageOrigin();
  const res = await fetch(`${origin}/deploy-config.json`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      "Missing or invalid deploy-config.json (HTTP " + res.status + "). Copy deploy-config.sample.json to deploy-config.json and fill in values."
    );
  }
  const raw = await res.json();
  backendOriginCache = normalizeApiOrigin(
    typeof raw.apiOrigin === "string" ? raw.apiOrigin : "",
    origin
  );
  const llmModel = String(raw.llmModel ?? raw.featherlessModel ?? DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL;
  const llmModelOptions = resolveLlmModelOptions(raw.llmModels ?? raw.llmModelList, llmModel);
  const prefixRaw = String(raw.llmProxyPrefix ?? "").trim().replace(/\/$/, "");
  const llmProxyPrefix = prefixRaw && prefixRaw.startsWith("/") ? prefixRaw : prefixRaw ? "/" + prefixRaw.replace(/^\/+/, "") : "/llm-api";
  const cookieSessionAuth = Boolean(raw.cookieSessionAuth);
  cached = {
    krogerClientId: String(raw.krogerClientId ?? ""),
    krogerRedirectUri: String(raw.krogerRedirectUri ?? ""),
    krogerLocationId: String(raw.krogerLocationId ?? ""),
    llmModel,
    llmModelOptions,
    llmProxyPrefix,
    cognitoDomain: normalizeCognitoDomain(String(raw.cognitoDomain ?? "")),
    cognitoClientId: String(raw.cognitoClientId ?? ""),
    cognitoRedirectUri: String(
      raw.cognitoRedirectUri ?? (origin ? origin + "/auth-callback.html" : "")
    ),
    authRequired: Boolean(raw.authRequired),
    authAllowAnonymousBrowsing: Boolean(raw.authAllowAnonymousBrowsing),
    subscriptionRequired: Boolean(raw.subscriptionRequired),
    cookieSessionAuth,
    testMode: Boolean(raw.testMode)
  };
  clearLegacyBrowserSecretsIfCookieSession(cookieSessionAuth);
  return cached;
}
async function ensurePublicConfig() {
  return loadDeployConfig();
}
function getPublicConfig() {
  if (!cached) {
    throw new Error("App configuration not loaded yet \u2014 call loadDeployConfig() first");
  }
  return cached;
}
function tryGetPublicConfig() {
  return cached;
}
function getBackendOrigin() {
  if (backendOriginCache !== null) return backendOriginCache;
  return typeof window !== "undefined" ? window.location.origin : "";
}
function apiUrl(path) {
  const b = getBackendOrigin();
  const p = path.startsWith("/") ? path : "/" + path;
  return b + p;
}
function getKrogerLocationId() {
  try {
    const saved = localStorage.getItem(SAVED_KROGER_LOCATION_ID_KEY);
    if (saved != null && saved.trim() !== "") return saved.trim();
  } catch {
  }
  return (tryGetPublicConfig()?.krogerLocationId ?? "").trim();
}
function getLlmModel() {
  const cfg = tryGetPublicConfig();
  const fallback = cfg?.llmModel && cfg.llmModel.trim() || DEFAULT_LLM_MODEL;
  const options = cfg?.llmModelOptions ?? [];
  if (typeof document !== "undefined") {
    const sel = document.getElementById("llmModelSelect");
    if (sel instanceof HTMLSelectElement && sel.options.length > 0) {
      const v = sel.value.trim();
      if (v && (options.length === 0 || options.includes(v))) return v;
    }
  }
  if (options.length >= 2) {
    try {
      const saved = localStorage.getItem(SAVED_LLM_MODEL_KEY);
      if (saved && options.includes(saved)) return saved;
    } catch {
    }
  }
  if (options.length >= 1) {
    if (options.includes(fallback)) return fallback;
    return options[0];
  }
  return fallback;
}
function getLlmProxyPrefix() {
  return tryGetPublicConfig()?.llmProxyPrefix ?? "/llm-api";
}
function getAppOrigin() {
  return getBackendOrigin();
}

// client/authed-fetch.ts
function mergeAppAuth(init2 = {}) {
  const cfg = tryGetPublicConfig();
  const cookieMode = Boolean(cfg?.cookieSessionAuth);
  const token = getCognitoAccessToken();
  const idToken = getCognitoIdToken();
  const headers = new Headers(init2.headers);
  if (!cookieMode) {
    if (token) {
      headers.set("Authorization", "Bearer " + token.replace(/\s+/g, "").trim());
    }
    if (idToken) {
      headers.set("X-Cognito-Id-Token", idToken.replace(/\s+/g, "").trim());
    }
  }
  const out = { ...init2, headers };
  if (cookieMode) {
    out.credentials = init2.credentials ?? "include";
  }
  return out;
}
function krogerProxyHeaders(krogerBearerToken) {
  const h = {};
  const cfg = tryGetPublicConfig();
  const cookieMode = Boolean(cfg?.cookieSessionAuth);
  if (!cookieMode) {
    const t = getCognitoAccessToken();
    const id = getCognitoIdToken();
    if (t) h.Authorization = "Bearer " + t.replace(/\s+/g, "").trim();
    if (id) h["X-Cognito-Id-Token"] = id.replace(/\s+/g, "").trim();
  }
  const kb = krogerBearerToken.replace(/^Bearer\s+/i, "").replace(/\s+/g, "").trim();
  if (kb) {
    h["X-Kroger-Authorization"] = "Bearer " + kb;
  }
  return h;
}

// client/kroger-app-launch.ts
var KROGER_SHOPPING_CART_URL = "https://www.kroger.com/shopping/cart";
var bulkBannerWired = false;
function wireBulkDoneBannerOnce() {
  if (bulkBannerWired) return;
  bulkBannerWired = true;
  document.getElementById("krogerBulkDoneOpenBtn")?.addEventListener("click", () => {
    window.open(KROGER_SHOPPING_CART_URL, "_blank", "noopener,noreferrer");
  });
  document.getElementById("krogerBulkDoneDismissBtn")?.addEventListener("click", () => {
    dismissKrogerBulkDoneBanner();
  });
}
function dismissKrogerBulkDoneBanner() {
  const el = document.getElementById("krogerBulkDoneBanner");
  if (el) el.hidden = true;
}
function showBulkAddKrogerFollowup(added, failed) {
  if (added <= 0) return;
  wireBulkDoneBannerOnce();
  const banner = document.getElementById("krogerBulkDoneBanner");
  const msg = document.getElementById("krogerBulkDoneBannerMessage");
  if (!banner || !msg) return;
  const lines = added === 1 ? "1 line was" : `${added} lines were`;
  const failPart = failed ? ` ${failed} line${failed === 1 ? "" : "s"} could not be added (see any alerts above).` : "";
  msg.textContent = `${lines} added to your Kroger cart.${failPart}`;
  banner.hidden = false;
  banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// client/billing.ts
async function subscribeToPlan() {
  try {
    await ensurePublicConfig();
    const res = await fetch(
      apiUrl("/api/billing/checkout-session"),
      mergeAppAuth({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    );
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Could not start checkout (" + res.status + ")");
      return;
    }
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    alert("No checkout URL returned.");
  } catch (e) {
    alert("Checkout failed: " + (e instanceof Error ? e.message : e));
  }
}
async function openBillingPortal() {
  try {
    await ensurePublicConfig();
    const res = await fetch(
      apiUrl("/api/billing/portal"),
      mergeAppAuth({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    );
    const data = await res.json();
    if (!res.ok) {
      if (data.error === "subscribe_first") {
        alert(
          typeof data.error_description === "string" && data.error_description.trim() ? data.error_description.trim() : "Click Subscribe in the header to start a subscription. Billing is for managing an existing plan."
        );
        return;
      }
      alert(data.error || "Could not open billing portal (" + res.status + ")");
      return;
    }
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    alert("No portal URL returned.");
  } catch (e) {
    alert("Billing portal failed: " + (e instanceof Error ? e.message : e));
  }
}

// client/auto-cart-strategy.ts
var TOKEN_STOPWORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "with",
  "to",
  "oz",
  "lb",
  "ct",
  "pack",
  "each",
  "per",
  "loaf",
  "slices",
  "slice"
]);
var FLAVOR_MISMATCH_TERMS = [
  "onion",
  "garlic",
  "jalapeno",
  "jalape\xF1o",
  "habanero",
  "buffalo",
  "sriracha",
  "cinnamon",
  "raisin",
  "cranberry",
  "blueberry",
  "pumpkin",
  "marble",
  "swirl",
  "pumpernickel",
  "truffle",
  "pretzel",
  "focaccia",
  "cornbread",
  "brioche",
  "challah",
  "zucchini",
  "mochi",
  "ube",
  "asiago",
  "pickle",
  "kimchi",
  "chocolate",
  "strawberry",
  "vanilla",
  "mocha",
  "everything",
  "poppy",
  "sesame",
  "potato",
  "rye",
  "sourdough",
  "naan",
  "pita",
  "tortilla",
  "wrap",
  "mini",
  "cocktail",
  "bite",
  "snack"
];
var STRATEGIES = [
  "default",
  "cheapest",
  "premium",
  "healthiest",
  "organic_first",
  "store_brand"
];
function parseAutoCartStrategy(raw) {
  const s = (raw || "").trim();
  if (STRATEGIES.includes(s)) return s;
  return "cheapest";
}
function haystack(p) {
  const bits = [p.name || ""];
  try {
    if (p.raw && typeof p.raw === "object") {
      bits.push(JSON.stringify(p.raw));
    }
  } catch {
  }
  return bits.join(" ").toLowerCase();
}
function tokenizeForMatch(s) {
  const cleaned = s.toLowerCase().replace(/\d+(\.\d+)?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return cleaned.split(/\s+/).filter((t) => t.length >= 2 && !TOKEN_STOPWORDS.has(t));
}
function searchLineProductFit(searchLine, productName) {
  const q = (searchLine || "").trim();
  const name = (productName || "").toLowerCase();
  if (!q || !name) return 0;
  const qt = tokenizeForMatch(q);
  if (qt.length === 0) return 0;
  let hits = 0;
  for (const t of qt) {
    if (name.includes(t)) hits += 1;
  }
  const qCompact = q.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const nCompact = name.replace(/[^a-z0-9]+/g, "");
  if (qCompact.length >= 3 && nCompact.includes(qCompact)) hits += 2;
  return hits;
}
function flavorMismatchPenalty(searchLine, productName) {
  const ql = (searchLine || "").toLowerCase();
  const nl = (productName || "").toLowerCase();
  let pen = 0;
  for (const term of FLAVOR_MISMATCH_TERMS) {
    if (nl.includes(term) && !ql.includes(term)) pen += 2;
  }
  return pen;
}
function autoPickRankScore(searchLine, p) {
  const q = (searchLine || "").trim();
  if (!q) return 0;
  return searchLineProductFit(q, p.name) * 5 - flavorMismatchPenalty(q, p.name);
}
function pickCheapest(products2, searchLine) {
  const withPrice = products2.filter((p) => p.price > 0);
  const pool = withPrice.length ? withPrice : products2;
  const q = (searchLine || "").trim();
  if (!q) {
    return [...pool].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))[0];
  }
  return [...pool].sort((a, b) => {
    const ra = autoPickRankScore(q, a);
    const rb = autoPickRankScore(q, b);
    if (rb !== ra) return rb - ra;
    return a.price - b.price || a.name.localeCompare(b.name);
  })[0];
}
function pickPremium(products2, searchLine) {
  const withPrice = products2.filter((p) => p.price > 0);
  const pool = withPrice.length ? withPrice : products2;
  const q = (searchLine || "").trim();
  if (!q) {
    return [...pool].sort((a, b) => b.price - a.price || a.name.localeCompare(b.name))[0];
  }
  return [...pool].sort((a, b) => {
    const ra = autoPickRankScore(q, a);
    const rb = autoPickRankScore(q, b);
    if (rb !== ra) return rb - ra;
    return b.price - a.price || a.name.localeCompare(b.name);
  })[0];
}
var HEALTH_PATTERNS = [
  { re: /\busda\s+organic\b/i, w: 6 },
  { re: /\borganic\b/i, w: 4 },
  { re: /\bnon[-\s]?gmo\b/i, w: 3 },
  { re: /\bwhole\s+grain\b/i, w: 2 },
  { re: /\b100%\s+whole\s+wheat\b/i, w: 2 },
  { re: /\bgrass[-\s]?fed\b/i, w: 2 },
  { re: /\bpasture[\s-]?raised\b/i, w: 2 },
  { re: /\bwild[\s-]?caught\b/i, w: 2 },
  { re: /\bno\s+added\s+sugar\b/i, w: 2 },
  { re: /\blow\s+sodium\b/i, w: 2 },
  { re: /\bunsweetened\b/i, w: 1 },
  { re: /\bplant[-\s]?based\b/i, w: 1 },
  { re: /\bvegan\b/i, w: 1 },
  { re: /\bheart\s+healthy\b/i, w: 2 },
  { re: /\bhigh\s+fiber\b/i, w: 1 }
];
var HEALTH_NEGATIVE = [
  { re: /\bartificial\b/i, w: -1 },
  { re: /\bhigh\s+fructose\b/i, w: -2 }
];
function healthScore(p) {
  const text = haystack(p);
  let score = 0;
  for (const { re, w } of HEALTH_PATTERNS) {
    if (re.test(text)) score += w;
  }
  for (const { re, w } of HEALTH_NEGATIVE) {
    if (re.test(text)) score += w;
  }
  return score;
}
function pickHealthiest(products2) {
  const scored = products2.map((p) => ({ p, s: healthScore(p) }));
  scored.sort((a, b) => b.s - a.s || a.p.price - b.p.price || a.p.name.localeCompare(b.p.name));
  if (scored[0].s > 0) return scored[0].p;
  return products2[0];
}
function pickOrganicFirst(products2, searchLine) {
  const organic = products2.filter((p) => /\borganic\b/i.test(haystack(p)));
  if (organic.length) return pickCheapest(organic, searchLine);
  return pickHealthiest(products2);
}
var STORE_BRAND_RE = /\b(simple\s+truth|private\s+selection|heritage\s+farm|hemis['']?\s*farms|kroger\s+naturals?|kroger\s+brand)\b/i;
function pickStoreBrand(products2, searchLine) {
  const branded = products2.filter((p) => STORE_BRAND_RE.test(haystack(p)));
  if (branded.length) return pickCheapest(branded, searchLine);
  return products2[0];
}
function pickProductByStrategy(products2, strategy, searchLine) {
  if (products2.length <= 1) return products2[0];
  switch (strategy) {
    case "default":
      return products2[0];
    case "cheapest":
      return pickCheapest(products2, searchLine);
    case "premium":
      return pickPremium(products2, searchLine);
    case "healthiest":
      return pickHealthiest(products2);
    case "organic_first":
      return pickOrganicFirst(products2, searchLine);
    case "store_brand":
      return pickStoreBrand(products2, searchLine);
    default:
      return products2[0];
  }
}
function autoStrategyLabel(strategy) {
  switch (strategy) {
    case "default":
      return "top search result";
    case "cheapest":
      return "lowest price among closer text matches (heuristic)";
    case "premium":
      return "highest price among closer text matches (heuristic)";
    case "healthiest":
      return "strongest healthy-label signals (organic, whole grain, etc.)";
    case "organic_first":
      return "organic if available, else health signals";
    case "store_brand":
      return "store brand / Simple Truth / Private Selection when listed";
    default:
      return strategy;
  }
}

// client/auto-cart-prefs.ts
function getAutoAddEnabled() {
  try {
    return localStorage.getItem(AUTO_ADD_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}
function setAutoAddEnabled(on) {
  try {
    localStorage.setItem(AUTO_ADD_ENABLED_KEY, on ? "1" : "0");
  } catch {
  }
}
function getAutoAddStrategy() {
  try {
    return parseAutoCartStrategy(localStorage.getItem(AUTO_ADD_STRATEGY_KEY));
  } catch {
    return "cheapest";
  }
}
function setAutoAddStrategy(strategy) {
  try {
    localStorage.setItem(AUTO_ADD_STRATEGY_KEY, strategy);
  } catch {
  }
}

// client/cart-feedback.ts
var toastHideTimer;
var toastDismissTimer;
function showAddToCartToast(displayName, quantity2, detail) {
  const root = document.getElementById("cartToast");
  if (!root) return;
  const main = root.querySelector(".cart-toast__main");
  const sub = root.querySelector(".cart-toast__detail");
  const safeName = displayName.length > 72 ? displayName.slice(0, 69).trimEnd() + "\u2026" : displayName;
  const line1 = `Added to your Kroger cart: ${safeName} \xD7 ${quantity2}`;
  if (main) {
    main.textContent = line1;
  } else {
    root.textContent = line1 + (detail ? "\n" + detail : "");
  }
  if (sub) {
    if (detail) {
      sub.textContent = detail;
      sub.hidden = false;
    } else {
      sub.textContent = "";
      sub.hidden = true;
    }
  }
  if (toastHideTimer) clearTimeout(toastHideTimer);
  if (toastDismissTimer) clearTimeout(toastDismissTimer);
  root.hidden = false;
  root.classList.remove("cart-toast--out");
  void root.offsetWidth;
  root.classList.add("cart-toast--visible");
  toastHideTimer = setTimeout(() => {
    root.classList.remove("cart-toast--visible");
    root.classList.add("cart-toast--out");
    toastDismissTimer = setTimeout(() => {
      root.hidden = true;
      root.classList.remove("cart-toast--out");
      if (main) main.textContent = "";
      if (sub) {
        sub.textContent = "";
        sub.hidden = true;
      }
      toastDismissTimer = void 0;
    }, 280);
    toastHideTimer = void 0;
  }, 5e3);
}

// client/kroger-tokens.ts
var krogerAccountLinked = false;
function getKrogerAccountLinked() {
  return krogerAccountLinked;
}
async function refreshKrogerLinkedFromApi() {
  try {
    await ensurePublicConfig();
  } catch {
    krogerAccountLinked = false;
    return;
  }
  if (!getPublicConfig().cookieSessionAuth) {
    krogerAccountLinked = false;
    return;
  }
  try {
    const r = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
    if (!r.ok) {
      krogerAccountLinked = false;
      return;
    }
    const j = await r.json();
    krogerAccountLinked = Boolean(j.krogerLinked);
  } catch {
    krogerAccountLinked = false;
  }
}
function clearKrogerToken() {
  appState.accessToken = null;
  localStorage.removeItem("krogerToken");
  localStorage.removeItem("tokenExpiry");
}
function getKrogerUserToken() {
  const token = localStorage.getItem("krogerUserToken");
  const expiry = localStorage.getItem("krogerUserTokenExpiry");
  if (!token) return null;
  const expiryMs = expiry ? parseInt(expiry, 10) : 0;
  if (expiryMs && !Number.isNaN(expiryMs) && Date.now() >= expiryMs) return null;
  return token.replace(/\s+/g, "").trim();
}
function hasKrogerUserSession() {
  if (tryGetPublicConfig()?.cookieSessionAuth) {
    return krogerAccountLinked;
  }
  return !!getKrogerUserToken() || !!localStorage.getItem("krogerUserRefreshToken");
}
async function getKrogerUserTokenOrRefresh() {
  await ensurePublicConfig();
  if (getPublicConfig().cookieSessionAuth) {
    return null;
  }
  const token = getKrogerUserToken();
  if (token) return token;
  const refreshToken = localStorage.getItem("krogerUserRefreshToken");
  if (!refreshToken) return null;
  const krogerPath = window.location.protocol === "file:" ? "" : "/kroger-api";
  if (krogerPath !== "/kroger-api") return null;
  try {
    const res = await fetch(
      apiUrl("/kroger-api/oauth-refresh"),
      mergeAppAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refreshToken: refreshToken.replace(/\s+/g, "").trim()
        })
      })
    );
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      localStorage.removeItem("krogerUserRefreshToken");
      localStorage.removeItem("krogerUserToken");
      localStorage.removeItem("krogerUserTokenExpiry");
      return null;
    }
    const newToken = String(data.access_token).replace(/\s+/g, "").trim();
    const expiresIn = data.expires_in != null && data.expires_in > 0 ? data.expires_in * 1e3 : 36e5;
    localStorage.setItem("krogerUserToken", newToken);
    localStorage.setItem("krogerUserTokenExpiry", String(Date.now() + expiresIn));
    if (data.refresh_token) {
      localStorage.setItem("krogerUserRefreshToken", String(data.refresh_token));
    }
    return newToken;
  } catch {
    localStorage.removeItem("krogerUserRefreshToken");
    localStorage.removeItem("krogerUserToken");
    localStorage.removeItem("krogerUserTokenExpiry");
    return null;
  }
}
function updateSignInUI() {
  const hasUser = hasKrogerUserSession();
  const signInBtn = document.getElementById("krogerSignInBtn");
  const signedIn = document.getElementById("krogerSignedIn");
  const lead = document.getElementById("krogerCardLead");
  if (signInBtn) signInBtn.style.display = hasUser ? "none" : "";
  if (signedIn) signedIn.style.display = hasUser ? "inline" : "none";
  if (lead) lead.hidden = hasUser;
}
async function signInWithKroger() {
  await ensurePublicConfig();
  const cfg = getPublicConfig();
  if (!cfg.krogerClientId) {
    alert(
      "Kroger sign-in is not configured on the server. Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in the server environment."
    );
    return;
  }
  sessionStorage.setItem("krogerOAuthRedirectUri", cfg.krogerRedirectUri);
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem("krogerOAuthState", state);
  const scope = "product.compact%20cart.basic%3Awrite";
  const url = "https://api.kroger.com/v1/connect/oauth2/authorize?client_id=" + encodeURIComponent(cfg.krogerClientId) + "&redirect_uri=" + encodeURIComponent(cfg.krogerRedirectUri) + "&response_type=code&scope=" + scope + "&state=" + encodeURIComponent(state);
  window.location.href = url;
}
async function signOutKroger() {
  try {
    await ensurePublicConfig();
    if (getPublicConfig().cookieSessionAuth) {
      await fetch(apiUrl("/api/kroger-session"), mergeAppAuth({ method: "DELETE" }));
    }
  } catch {
  }
  localStorage.removeItem("krogerUserToken");
  localStorage.removeItem("krogerUserTokenExpiry");
  localStorage.removeItem("krogerUserRefreshToken");
  krogerAccountLinked = false;
  updateSignInUI();
}
async function getAccessToken() {
  const expiryRaw = localStorage.getItem("tokenExpiry");
  const expiry = expiryRaw != null ? JSON.parse(expiryRaw) : null;
  if (appState.accessToken && expiry && Date.now() < expiry) {
    const t = String(appState.accessToken).trim();
    if (t) return t;
  }
  const krogerPath = window.location.protocol === "file:" ? "" : "/kroger-api";
  const useServerToken = krogerPath === "/kroger-api";
  if (!useServerToken) {
    throw new Error(
      "Open this app from your server (http://localhost:8000/...) so product search can use secure Kroger credentials on the server."
    );
  }
  await ensurePublicConfig();
  const response = await fetch(
    apiUrl("/kroger-api/token"),
    mergeAppAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    })
  );
  const tokenJson = await response.json();
  if (!tokenJson.access_token) {
    clearKrogerToken();
    throw new Error(
      tokenJson.error_description || tokenJson.error || "Failed to get access token (check server KROGER_CLIENT_ID / KROGER_CLIENT_SECRET)"
    );
  }
  const token = String(tokenJson.access_token).replace(/\s+/g, "").trim();
  if (token.length < 20) {
    clearKrogerToken();
    throw new Error("Token from Kroger was too short or invalid.");
  }
  const expiresIn = tokenJson.expires_in != null && tokenJson.expires_in > 0 ? tokenJson.expires_in * 1e3 : 36e5;
  const expiryMs = Math.min(expiresIn, Math.max(0, expiresIn - 5 * 60 * 1e3));
  appState.accessToken = token;
  localStorage.setItem("krogerToken", token);
  localStorage.setItem("tokenExpiry", String(Date.now() + expiryMs));
  return token;
}

// client/html-utils.ts
function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML.replace(/"/g, "&quot;");
}
function isSectionHeader(line) {
  const s = (line || "").replace(/\*+$/g, "").trim();
  if (/^(meal\s*plan|grocery\s*list|shopping\s*list|ingredients\s*list)\s*:?\s*$/i.test(s))
    return true;
  if (/^day\s*\d+\s*:?\s*$/i.test(s)) return true;
  if (/^meal\s*plan\s+for\s+/i.test(s)) return true;
  if (/^recipes\s*:?\s*$/i.test(s)) return true;
  return false;
}
function stripLeadingMarkdownHeading(line) {
  return (line || "").replace(/^\s*#{1,6}\s*/, "").trim();
}
function isStructuralPlanLine(line) {
  const raw = (line || "").trim();
  if (!raw) return true;
  if (/^#{1,6}(\s+\S|\s*$)/.test(raw)) return true;
  const s = stripLeadingMarkdownHeading(raw);
  const cleaned = cleanGroceryLine(s.length ? s : raw);
  if (isSectionHeader(raw) || isSectionHeader(s) || isSectionHeader(cleaned)) return true;
  if (isMealPlanLine(raw) || isMealPlanLine(s) || isMealPlanLine(cleaned)) return true;
  if (/^day\s*\d+\s*[—\-–]\s*\S/i.test(cleaned)) return true;
  if (/^day\s*\d+\s*:\s*\S/i.test(cleaned)) return true;
  if (/^day\s*\d+\b/i.test(cleaned) && cleaned.length < 48) return true;
  if (/day[\s\-–]+by[\s\-–]+day/i.test(cleaned)) return true;
  if (/\boverview\b/i.test(cleaned) && /day|meal|plan/i.test(cleaned)) return true;
  if (/^recipes?\s*:?\s*$/i.test(cleaned)) return true;
  if (/^ingredients\s*(\(|:)/i.test(cleaned)) return true;
  if (/^steps?\s*:?\s*$/i.test(cleaned)) return true;
  if (/^#{1,6}\s*\S/.test(cleaned)) return true;
  return false;
}
function cleanGroceryLine(line) {
  const s = (line || "").replace(/^\*+|\*+$/g, "").trim();
  return s.replace(/^[\-\*•·\d.]+\s*/, "").trim();
}
function isMealPlanLine(line) {
  const s = cleanGroceryLine(line).trim();
  return /^(breakfast|brunch|lunch|dinner|supper|snack)\s*:/i.test(s);
}
function parseGroceryLines(text) {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const result = [];
  let inList = false;
  const listHeaders = /^(grocery|shopping)\s*list\s*:?\s*\**$/i;
  for (const line of lines) {
    const normalized = (line || "").replace(/^\*+|\*+$/g, "").trim();
    if (listHeaders.test(normalized) || /^(grocery|shopping)\s*list\s*:?\s*$/i.test(normalized)) {
      inList = true;
      continue;
    }
    if (isSectionHeader(line)) continue;
    if (isMealPlanLine(line)) continue;
    if (inList) {
      const cleaned = cleanGroceryLine(line);
      if (cleaned.length > 1 && !isStructuralPlanLine(line) && !isStructuralPlanLine(cleaned)) {
        result.push(cleaned);
      }
      continue;
    }
  }
  let fallbackLines = lines;
  const tailMatch = text.match(/(?:^|\n)\s*(?:grocery|shopping)\s*list\s*:?\s*(?:\n|$)/im);
  if (tailMatch && typeof tailMatch.index === "number") {
    const after = text.slice(tailMatch.index + tailMatch[0].length);
    const tail = after.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (tail.length) fallbackLines = tail;
  }
  const fallback = fallbackLines.map((l) => cleanGroceryLine(l)).filter((l, i) => {
    const raw = fallbackLines[i] ?? l;
    return l.length > 2 && l.length < 120 && !isStructuralPlanLine(raw) && !isStructuralPlanLine(l);
  });
  return result.length ? result : fallback;
}
function shortProductName(name) {
  if (!name || typeof name !== "string") return name || "";
  const comma = name.indexOf(",");
  return comma > 0 ? name.slice(0, comma).trim() : name.trim();
}

// client/cart-api.ts
async function addProductToCart(product, quantity2, options) {
  await ensurePublicConfig();
  const cookieMode = Boolean(tryGetPublicConfig()?.cookieSessionAuth);
  let userToken = "";
  if (cookieMode) {
    await refreshKrogerLinkedFromApi();
    if (!getKrogerAccountLinked()) {
      alert("Please sign in with Kroger first.");
      return false;
    }
  } else {
    const t = await getKrogerUserTokenOrRefresh();
    if (!t) {
      alert("Please sign in with Kroger first.");
      return false;
    }
    userToken = t;
  }
  const fileProto = window.location.protocol === "file:";
  const krogerBase = fileProto ? "https://api.kroger.com" : "";
  const krogerPrefix = fileProto ? "" : getBackendOrigin() + "/kroger-api";
  const cartUrl = krogerBase + krogerPrefix + "/v1/cart/add";
  const itemData = {
    items: [
      {
        quantity: quantity2,
        upc: product.upc || void 0,
        productId: product.productId || void 0,
        product: { name: shortProductName(product.name), price: product.price }
      }
    ]
  };
  try {
    const response = await fetch(cartUrl, {
      method: "PUT",
      headers: {
        ...krogerProxyHeaders(cookieMode ? "" : userToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(itemData),
      ...tryGetPublicConfig()?.cookieSessionAuth ? { credentials: "include" } : {}
    });
    const text = await response.text();
    let result = {};
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = {};
    }
    if (response.status === 403) {
      const err = result;
      if (err.error === "subscription_required") {
        alert("An active subscription is required. Click Subscribe in the header.");
        return false;
      }
      if (err.code === "AUTH-1007") {
        alert("Cart request was denied. Try signing out and signing in again.");
        return false;
      }
      alert("Cart request was denied. Try signing out and signing in again.");
      return false;
    }
    if (result.code === "AUTH-1007") {
      alert("Cart request was denied. Try signing out and signing in again.");
      return false;
    }
    if (!response.ok) {
      alert(
        "Error adding to cart: " + (result.message || result.code || response.status)
      );
      return false;
    }
    displayCart(result);
    showAddToCartToast(shortProductName(product.name), quantity2, options?.toastDetail);
    return true;
  } catch (e) {
    console.error(e);
    alert("Error adding to cart: " + (e instanceof Error ? e.message : e));
    return false;
  }
}
function displayCart(items) {
  const cartDiv = document.getElementById("cart");
  if (!cartDiv) return;
  cartDiv.innerHTML = "";
  if (items?.items && items.items.length > 0) {
    for (const item of items.items) {
      const itemDiv = document.createElement("div");
      itemDiv.textContent = `${item.product.name} x${item.quantity} - $${(item.product.price * item.quantity).toFixed(2)}`;
      cartDiv.appendChild(itemDiv);
    }
  } else {
    cartDiv.textContent = "Your cart is empty";
  }
}

// client/kroger-products.ts
async function searchKrogerProducts(token, searchTerm, limit = 10) {
  await ensurePublicConfig();
  const fileProto = window.location.protocol === "file:";
  const krogerBase = fileProto ? "https://api.kroger.com" : "";
  const krogerPrefix = fileProto ? "" : getBackendOrigin() + "/kroger-api";
  let url = krogerBase + krogerPrefix + "/v1/products?filter.term=" + encodeURIComponent(searchTerm) + "&filter.limit=" + limit;
  const loc = getKrogerLocationId();
  if (loc) url += "&filter.locationId=" + encodeURIComponent(loc);
  const bearerToken = String(token).replace(/\s+/g, "").trim();
  const res = await fetch(url, {
    headers: krogerProxyHeaders(bearerToken),
    ...tryGetPublicConfig()?.cookieSessionAuth ? { credentials: "include" } : {}
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 || json.code && String(json.code) === "AUTH-1007") {
    clearKrogerToken();
    throw new Error("Kroger returned invalid token. Try signing in again.");
  }
  if (!res.ok) return [];
  const list = json.data || json.items || [];
  return list.map((p) => {
    const priceObj = p.items?.[0] != null ? p.items[0].price : p.price != null ? { regular: p.price } : null;
    const priceObj2 = priceObj;
    const price = priceObj2?.regular ?? priceObj2?.promo ?? 0;
    const product = {
      upc: String(p.upc || p.productId || ""),
      productId: String(p.productId || p.upc || ""),
      name: String(p.description || p.productId || searchTerm),
      price: typeof price === "number" ? price : parseFloat(String(price)) || 0,
      raw: p
    };
    return product;
  });
}

// client/picker-context.ts
var products = [];
var productsOriginal = [];
var quantity = 1;
function setPickerSession(prods, qty) {
  productsOriginal = [...prods];
  products = [...prods];
  quantity = qty;
}
function getPickerProducts() {
  return products;
}
function getPickerProductsOriginal() {
  return productsOriginal;
}
function setPickerProductsOrdered(next) {
  products = next;
}
function getPickerQuantity() {
  return quantity;
}

// client/product-picker.ts
function closeProductPicker() {
  const modal = document.getElementById("productPickerModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}
function renderProductPickerList(sortBy) {
  const listEl = document.getElementById("productPickerList");
  const original = getPickerProductsOriginal();
  if (!listEl || original.length === 0) return;
  let ordered;
  if (sortBy === "price-asc") {
    ordered = [...original].sort((a, b) => a.price - b.price);
  } else if (sortBy === "price-desc") {
    ordered = [...original].sort((a, b) => b.price - a.price);
  } else {
    ordered = [...original];
  }
  setPickerProductsOrdered(ordered);
  listEl.innerHTML = ordered.map((p, i) => {
    const name = escapeHtml(p.name || "Product " + (i + 1));
    const price = p.price > 0 ? "$" + p.price.toFixed(2) : "Price N/A";
    return '<div class="modal-product"><div class="info"><span class="name">' + name + '</span><br><span class="price">' + price + '</span></div><div class="modal-product-actions"><button type="button" class="btn-meta" data-picker-index="' + i + `" onclick="showProductMetadata(parseInt(this.getAttribute('data-picker-index'),10))">Metadata</button><button type="button" class="btn-add" data-picker-index="` + i + `" onclick="pickProductAndAdd(parseInt(this.getAttribute('data-picker-index'),10))">Add to cart</button></div></div>`;
  }).join("");
}
function showProductPicker(prods, qty, searchTerm) {
  const title = document.getElementById("productPickerTitle");
  const toolbarEl = document.getElementById("productPickerToolbar");
  const listEl = document.getElementById("productPickerList");
  const modal = document.getElementById("productPickerModal");
  if (!title || !toolbarEl || !listEl || !modal) return;
  title.textContent = 'Choose a product for "' + (searchTerm || "") + '"';
  setPickerSession(prods, qty);
  toolbarEl.innerHTML = '<label for="productPickerSortSelect">Sort:</label><select id="productPickerSortSelect" aria-label="Sort by price"><option value="default">Default order</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select>';
  const sortSelect = document.getElementById("productPickerSortSelect");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      renderProductPickerList(sortSelect.value || "default");
    });
  }
  renderProductPickerList("default");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}
function showProductMetadata(index) {
  const products2 = getPickerProducts();
  const preEl = document.getElementById("productMetadataPre");
  const metaModal = document.getElementById("productMetadataModal");
  if (!products2[index] || !preEl || !metaModal) return;
  const product = products2[index];
  const toShow = product.raw != null ? product.raw : product;
  preEl.textContent = JSON.stringify(toShow, null, 2);
  metaModal.classList.remove("hidden");
  metaModal.setAttribute("aria-hidden", "false");
}
function closeProductMetadata() {
  const metaModal = document.getElementById("productMetadataModal");
  if (metaModal) {
    metaModal.classList.add("hidden");
    metaModal.setAttribute("aria-hidden", "true");
  }
}
async function pickProductAndAdd(index) {
  const products2 = getPickerProducts();
  const qty = getPickerQuantity();
  if (!products2[index]) return;
  closeProductPicker();
  await addProductToCart(products2[index], qty ?? 1);
}

// client/add-to-cart.ts
var SEARCH_LIMIT_MANUAL = 10;
var SEARCH_LIMIT_AUTO = 30;
async function addItem() {
  const productEl = document.getElementById("product");
  const qtyEl = document.getElementById("quantity");
  const productName = productEl?.value?.trim() ?? "";
  const quantity2 = parseInt(qtyEl?.value ?? "", 10);
  await searchAndAddToCart(productName, quantity2);
}
async function searchAndAddToCart(productName, quantity2) {
  const name = productName.trim();
  if (!name || isNaN(quantity2) || quantity2 <= 0) {
    alert("Please enter a valid product name and quantity.");
    return false;
  }
  await ensurePublicConfig();
  const cookieMode = Boolean(tryGetPublicConfig()?.cookieSessionAuth);
  if (cookieMode) {
    await refreshKrogerLinkedFromApi();
    if (!getKrogerAccountLinked()) {
      alert(
        'Please sign in with Kroger first (click "Sign in with Kroger" above) to add items to your cart.'
      );
      return false;
    }
  } else {
    const userToken = await getKrogerUserTokenOrRefresh();
    if (!userToken) {
      alert(
        'Please sign in with Kroger first (click "Sign in with Kroger" above) to add items to your cart.'
      );
      return false;
    }
  }
  try {
    const appToken = await getAccessToken();
    const searchTerm = shortProductName(name);
    const auto = getAutoAddEnabled();
    const limit = auto ? SEARCH_LIMIT_AUTO : SEARCH_LIMIT_MANUAL;
    const products2 = await searchKrogerProducts(appToken, searchTerm, limit);
    if (products2.length === 0) {
      alert('No products found for "' + searchTerm + '".');
      return false;
    }
    if (products2.length === 1) {
      return addProductToCart(products2[0], quantity2);
    }
    if (auto) {
      const strategy = getAutoAddStrategy();
      const chosen = pickProductByStrategy(products2, strategy, searchTerm);
      const priceNote = chosen.price > 0 ? " \xB7 $" + chosen.price.toFixed(2) : "";
      return addProductToCart(chosen, quantity2, {
        toastDetail: autoStrategyLabel(strategy) + priceNote
      });
    }
    showProductPicker(products2, quantity2, searchTerm);
    return false;
  } catch (error) {
    console.error(error);
    alert("Error adding item to cart: " + (error instanceof Error ? error.message : error));
    return false;
  }
}

// client/meal-plan.ts
function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function defaultMealPlanPrefs() {
  return {
    people: 3,
    days: 7,
    includeBreakfast: true,
    includeLunch: true,
    includeDinner: true,
    includeRecipes: true,
    notes: ""
  };
}
function legacyScopeToMeals(scope) {
  if (scope === "dinner_only") {
    return { includeBreakfast: false, includeLunch: false, includeDinner: true };
  }
  if (scope === "lunch_dinner") {
    return { includeBreakfast: false, includeLunch: true, includeDinner: true };
  }
  return { includeBreakfast: true, includeLunch: true, includeDinner: true };
}
function parseStoredMealPrefs(raw) {
  const d = defaultMealPlanPrefs();
  if (!raw) return d;
  try {
    const o = JSON.parse(raw);
    const fromLegacy = typeof o.mealScope === "string" ? legacyScopeToMeals(o.mealScope) : null;
    let includeBreakfast = typeof o.includeBreakfast === "boolean" ? o.includeBreakfast : fromLegacy?.includeBreakfast ?? d.includeBreakfast;
    let includeLunch = typeof o.includeLunch === "boolean" ? o.includeLunch : fromLegacy?.includeLunch ?? d.includeLunch;
    let includeDinner = typeof o.includeDinner === "boolean" ? o.includeDinner : fromLegacy?.includeDinner ?? d.includeDinner;
    if (!includeBreakfast && !includeLunch && !includeDinner) {
      includeBreakfast = true;
      includeLunch = true;
      includeDinner = true;
    }
    return {
      people: clampInt(Number(o.people), 1, 16),
      days: clampInt(Number(o.days), 1, 14),
      includeBreakfast,
      includeLunch,
      includeDinner,
      includeRecipes: typeof o.includeRecipes === "boolean" ? o.includeRecipes : d.includeRecipes,
      notes: typeof o.notes === "string" ? o.notes.slice(0, 800) : ""
    };
  } catch {
    return d;
  }
}
function buildMealsInstruction(prefs) {
  const b = prefs.includeBreakfast;
  const l = prefs.includeLunch;
  const d = prefs.includeDinner;
  if (!b && !l && !d) {
    return "For each day list only dinner with specific dish names.";
  }
  const parts = [];
  if (b) parts.push("breakfast");
  if (l) parts.push("lunch");
  if (d) parts.push("dinner");
  return `For each day include only these meals, with specific dish names: ${parts.join(", ")}. Do not plan or list ingredients for any other meals.`;
}
function buildMealPlanPrompt(prefs) {
  const people = clampInt(prefs.people, 1, 16);
  const days = clampInt(prefs.days, 1, 14);
  const scopeLine = buildMealsInstruction(prefs);
  const notes = (prefs.notes || "").trim().slice(0, 800);
  const notesBlock = notes ? `

Additional constraints from the user (follow these closely):
${notes}
` : "";
  const dayWord = days === 1 ? "1 day" : `${days} days`;
  const peopleWord = people === 1 ? "1 person" : `${people} people`;
  const listMin = Math.min(50, Math.max(15, 18 + people * 2 + Math.floor(days / 2)));
  const listMax = Math.min(80, Math.max(listMin + 5, 28 + people * 3 + days));
  const recipeBlock = prefs.includeRecipes ? `

After the day-by-day overview, add a section that starts on its own line with exactly: Recipes:
Under Recipes, for every dish you listed (each breakfast, lunch, and dinner across all days), include a small block:
- A line with the day, meal type, and dish name (e.g. "Day 2 \u2014 Lunch: Turkey sandwich").
- A line "Ingredients (for ${peopleWord} for this dish):" then a short bullet list with amounts for that dish only.
- A line "Steps:" then 3\u20136 numbered, concise steps (practical, not essay-length).

Do not put recipe ingredient bullets under any heading named "Grocery list" or "Shopping list"\u2014those headings are reserved for the consolidated list below.` : `

Keep the day-by-day plan brief: short dish names only\u2014no per-dish ingredient lists or cooking steps in the plan section.`;
  const groceryRules = `Then provide ONE consolidated grocery list for the entire period. Rules for the grocery list:
- Scale all quantities for ${peopleWord} across every meal in the plan.
- List each ingredient exactly ONCE. Add up all amounts needed across every recipe and write a single line per ingredient (e.g. "chicken breast, 4 lb" not separate lines for partial amounts).
- Use sensible units: milk and juice in gallons or half-gallons; eggs by count (e.g. "18 eggs"); meat and deli in lb; butter in lb or sticks; flour, sugar, rice in lb; produce in lb or count as appropriate (e.g. "3 onions", "2 lb carrots"); canned goods by count (e.g. "2 (15 oz) cans black beans"). Never use "lb" for liquids like milk.
- Keep the list concise: about ${listMin}\u2013${listMax} line items total (adjust for household size). No duplicate ingredients.
- Put the consolidated list ONLY under a line that reads exactly "Grocery list:" or "Shopping list:" (then one shopping item per line, bullet or plain). Nothing before that line belongs in the store list.`;
  const tailNote = prefs.includeRecipes ? `- After Recipes, output the consolidated grocery list as specified.` : `- Be concise: short meal names and list items only.`;
  return `Create a meal plan for ${dayWord} for a household of ${peopleWord}. ${scopeLine} Start with a clear day-by-day overview (each day: the meals you are including, with specific dish names).${notesBlock}${recipeBlock}

${groceryRules}
${tailNote}`;
}
function mealPlanNumPredict(prefs) {
  return prefs.includeRecipes ? 8192 : 2048;
}
function readMealPlanPrefsFromForm() {
  const peopleEl = document.getElementById("mealPlanPeople");
  const daysEl = document.getElementById("mealPlanDays");
  const bEl = document.getElementById("mealPlanBreakfast");
  const lEl = document.getElementById("mealPlanLunch");
  const dEl = document.getElementById("mealPlanDinner");
  const recipesEl = document.getElementById("mealPlanRecipes");
  const notesEl = document.getElementById("mealPlanNotes");
  let includeBreakfast = Boolean(bEl?.checked);
  let includeLunch = Boolean(lEl?.checked);
  let includeDinner = Boolean(dEl?.checked);
  if (!includeBreakfast && !includeLunch && !includeDinner) {
    includeBreakfast = true;
    includeLunch = true;
    includeDinner = true;
    if (bEl) bEl.checked = true;
    if (lEl) lEl.checked = true;
    if (dEl) dEl.checked = true;
  }
  return {
    people: clampInt(parseInt(peopleEl?.value ?? "3", 10), 1, 16),
    days: clampInt(parseInt(daysEl?.value ?? "7", 10), 1, 14),
    includeBreakfast,
    includeLunch,
    includeDinner,
    includeRecipes: recipesEl ? recipesEl.checked : true,
    notes: (notesEl?.value ?? "").slice(0, 800)
  };
}
function applyMealPlanPrefsToForm(prefs) {
  const peopleEl = document.getElementById("mealPlanPeople");
  const daysEl = document.getElementById("mealPlanDays");
  const bEl = document.getElementById("mealPlanBreakfast");
  const lEl = document.getElementById("mealPlanLunch");
  const dEl = document.getElementById("mealPlanDinner");
  const notesEl = document.getElementById("mealPlanNotes");
  if (peopleEl) peopleEl.value = String(clampInt(prefs.people, 1, 16));
  if (daysEl) daysEl.value = String(clampInt(prefs.days, 1, 14));
  if (bEl) bEl.checked = prefs.includeBreakfast;
  if (lEl) lEl.checked = prefs.includeLunch;
  if (dEl) dEl.checked = prefs.includeDinner;
  const recipesEl = document.getElementById("mealPlanRecipes");
  if (recipesEl) recipesEl.checked = prefs.includeRecipes;
  if (notesEl) notesEl.value = prefs.notes.slice(0, 800);
}
function persistMealPlanPrefs(prefs) {
  try {
    localStorage.setItem(SAVED_MEAL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
  }
}
function initMealPlanForm() {
  applyMealPlanPrefsToForm(parseStoredMealPrefs(localStorage.getItem(SAVED_MEAL_PREFS_KEY)));
  const ids = [
    "mealPlanPeople",
    "mealPlanDays",
    "mealPlanBreakfast",
    "mealPlanLunch",
    "mealPlanDinner",
    "mealPlanRecipes",
    "mealPlanNotes"
  ];
  const onChange = () => persistMealPlanPrefs(readMealPlanPrefsFromForm());
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("change", onChange);
    if (el instanceof HTMLInputElement && el.type === "number") {
      el.addEventListener("input", onChange);
    }
    if (el instanceof HTMLTextAreaElement) {
      el.addEventListener("input", onChange);
    }
  }
}

// client/example-meal-plan.ts
var EXAMPLE_MEAL_PLAN_TEXT = `Sample meal plan (example \u2014 not from AI)

Day 1
- Breakfast: Oatmeal with banana and cinnamon
- Lunch: Turkey and cheese sandwich, apple
- Dinner: Baked chicken thighs, roasted broccoli, rice

Day 2
- Breakfast: Greek yogurt with honey and granola
- Lunch: Leftover chicken rice bowl
- Dinner: Spaghetti with marinara, side salad

Day 3
- Breakfast: Scrambled eggs, whole wheat toast, orange juice
- Lunch: Tuna salad wrap, carrot sticks
- Dinner: Beef tacos with lettuce, cheddar, salsa

Day 4
- Breakfast: Pancakes with maple syrup
- Lunch: Tomato soup with grilled cheese
- Dinner: Salmon fillet, green beans, quinoa

Day 5
- Breakfast: Cereal with milk, berries
- Lunch: Caesar salad with rotisserie chicken
- Dinner: Stir-fry vegetables and tofu over rice

Day 6
- Breakfast: Bagel with cream cheese, fruit
- Lunch: Bean and cheese burrito
- Dinner: Pork chops, mashed potatoes, peas

Day 7
- Breakfast: French toast, bacon
- Lunch: Chef salad with ranch
- Dinner: Homemade pizza, cucumber salad

Grocery list:
- milk, 1 gallon
- eggs, 18 count
- butter, 1 lb
- cheddar cheese, 1 lb
- bread, 2 loaves
- boneless chicken thighs, 3 lb
- ground beef, 1.5 lb
- salmon fillet, 1.5 lb
- pork chops, 2 lb
- turkey slices, 1 lb
- tofu firm, 14 oz
- spaghetti, 1 lb
- marinara sauce, 24 oz
- rice, 2 lb
- quinoa, 1 lb
- rolled oats, 18 oz
- Greek yogurt, 32 oz
- bananas, 6 count
- apples, 6 count
- broccoli crowns, 2 lb
- fresh spinach, 10 oz
- romaine lettuce, 2 heads
- frozen mixed vegetables, 32 oz
- black beans canned, 2 (15 oz)
- diced tomatoes canned, 2 (15 oz)
- tortillas flour, 10 count
- potatoes russet, 5 lb
- yellow onions, 3 count
- garlic, 1 head
- olive oil, 16 oz
- salt and black pepper
`;

// client/auto-cart-ui.ts
var CHECKBOX_ID = "autoAddToCartEnabled";
var SELECT_ID = "autoAddToCartStrategy";
function syncSelectDisabled() {
  const cb = document.getElementById(CHECKBOX_ID);
  const sel = document.getElementById(SELECT_ID);
  if (!cb || !sel) return;
  sel.disabled = !cb.checked;
}
var ADD_ALL_TOOLBAR_ID = "addAllCartToolbar";
var ADD_SELECTED_BTN_ID = "addSelectedToCartBtn";
function syncAddAllToCartToolbar() {
  const toolbar = document.getElementById(ADD_ALL_TOOLBAR_ID);
  const section = document.getElementById("add-to-cart-section");
  if (!toolbar || !section) return;
  const lineCount = document.getElementById("generated-list")?.querySelectorAll(".grocery-line").length ?? 0;
  const sectionVisible = section.style.display !== "none";
  const show = getAutoAddEnabled() && sectionVisible && lineCount > 0;
  toolbar.hidden = !show;
  const addSelected = document.getElementById(ADD_SELECTED_BTN_ID);
  if (addSelected) {
    const checked = document.querySelectorAll("#generated-list .grocery-line-check:checked").length;
    addSelected.disabled = checked === 0;
  }
}
function initAutoCartPreferencesUi() {
  const cb = document.getElementById(CHECKBOX_ID);
  const sel = document.getElementById(SELECT_ID);
  if (!cb || !sel) return;
  cb.checked = getAutoAddEnabled();
  const s = getAutoAddStrategy();
  if (Array.from(sel.options).some((o) => o.value === s)) {
    sel.value = s;
  }
  syncSelectDisabled();
  cb.addEventListener("change", () => {
    setAutoAddEnabled(cb.checked);
    syncSelectDisabled();
    syncAddAllToCartToolbar();
  });
  sel.addEventListener("change", () => {
    setAutoAddStrategy(sel.value);
  });
  const listEl = document.getElementById("generated-list");
  listEl?.addEventListener("change", (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.classList.contains("grocery-line-check")) {
      syncAddAllToCartToolbar();
    }
  });
}

// client/grocery-generation.ts
var BULK_ADD_DELAY_MS = 400;
async function assertApiLlmReadyForFeatherless(llmPrefix) {
  const healthUrl = apiUrl("/api/health");
  let res;
  try {
    res = await fetch(healthUrl, { cache: "no-store" });
  } catch {
    return;
  }
  const raw = await res.text();
  let h;
  try {
    h = JSON.parse(raw);
  } catch {
    throw new Error(
      "GET " + healthUrl + " did not return JSON. In deploy-config.json set `apiOrigin` to the base URL of your **Node API** (Express), not only the static site. That host must serve /api/health and POST " + llmPrefix + "/api/chat. If the UI is on www and the API is elsewhere, apiOrigin must point at the API (e.g. your ECS/ALB URL)."
    );
  }
  if (!res.ok || !h.ok) {
    throw new Error("API health check failed at " + healthUrl + " (HTTP " + res.status + ").");
  }
  if (h.featherlessKeyConfigured === false) {
    throw new Error(
      "The API server at " + getAppOrigin() + " is reachable but FEATHERLESS_API_KEY is not set there. Upstream Featherless is never called until you add the key to the **same** environment that runs this API (e.g. ECS task definition / container secrets), then redeploy."
    );
  }
}
function getCheckedGroceryLinesFromDom() {
  const list = document.getElementById("generated-list");
  if (!list) return [];
  const out = [];
  list.querySelectorAll(".grocery-line").forEach((row) => {
    const cb = row.querySelector("input.grocery-line-check");
    if (cb?.checked) {
      const line = row.getAttribute("data-line");
      if (line) out.push(line);
    }
  });
  return out;
}
function setBulkCartButtonsDisabled(disabled) {
  for (const id of ["addAllToCartBtn", "addSelectedToCartBtn"]) {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  }
}
async function bulkAddGroceryLines(lines) {
  let added = 0;
  let failed = 0;
  for (let i = 0; i < lines.length; i++) {
    const ok = await searchAndAddToCart(lines[i], 1);
    if (ok) added++;
    else failed++;
    if (i < lines.length - 1) {
      await new Promise((r) => setTimeout(r, BULK_ADD_DELAY_MS));
    }
  }
  return { added, failed };
}
function renderGeneratedResult(text) {
  appState.lastGeneratedText = text;
  const out = document.getElementById("generated");
  const cartSection = document.getElementById("add-to-cart-section");
  const listEl = document.getElementById("generated-list");
  if (!out || !cartSection || !listEl) return;
  out.style.display = "block";
  out.innerHTML = '<pre class="generated-text">' + escapeHtml(text) + '</pre><p class="generated-actions"><button type="button" onclick="saveLLMToStorage()">Save to storage</button><button type="button" class="btn-secondary" onclick="copyGroceryListToClipboard()">Copy grocery list</button></p>';
  const items = parseGroceryLines(text);
  if (items.length) {
    listEl.innerHTML = items.map(
      (line) => '<div class="grocery-line" data-line="' + escapeHtml(line) + '"><label class="grocery-line__pick"><input type="checkbox" class="grocery-line-check" checked aria-label="Include this line when using Add selected to cart" /></label><span class="label">' + escapeHtml(line) + '</span><button type="button" onclick="addSuggestedItem(this)">Add to cart</button></div>'
    ).join("");
    cartSection.style.display = "block";
  } else {
    listEl.innerHTML = "";
    cartSection.style.display = "none";
  }
  syncAddAllToCartToolbar();
}
function saveLLMToStorage() {
  if (!appState.lastGeneratedText) return;
  try {
    localStorage.setItem(SAVED_LLM_KEY, appState.lastGeneratedText);
    const loadBtn = document.getElementById("loadSavedBtn");
    if (loadBtn) loadBtn.style.display = "";
    alert('Saved. Use "Load saved" to restore without calling the LLM.');
  } catch (e) {
    alert("Save failed: " + (e instanceof Error ? e.message : e));
  }
}
function loadSavedLLM() {
  try {
    const saved = localStorage.getItem(SAVED_LLM_KEY);
    if (!saved) {
      alert('Nothing saved. Generate a list first, then click "Save to storage".');
      return;
    }
    renderGeneratedResult(saved);
  } catch (e) {
    alert("Load failed: " + (e instanceof Error ? e.message : e));
  }
}
function loadExampleMealPlan() {
  renderGeneratedResult(EXAMPLE_MEAL_PLAN_TEXT);
}
async function copyGroceryListToClipboard() {
  const lines = parseGroceryLines(appState.lastGeneratedText);
  if (!lines.length) {
    alert("No grocery list to copy. Generate a list first.");
    return;
  }
  const text = lines.join("\n");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      alert("Grocery list copied to clipboard.");
      return;
    }
  } catch {
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    alert("Grocery list copied to clipboard.");
  } catch (e) {
    alert("Copy failed: " + (e instanceof Error ? e.message : e));
  }
}
function addSuggestedItem(btnOrLine) {
  let line = typeof btnOrLine === "string" ? btnOrLine : btnOrLine.getAttribute("data-line");
  if (!line && typeof btnOrLine !== "string") {
    line = btnOrLine.closest(".grocery-line")?.getAttribute("data-line") ?? null;
  }
  if (!line) return;
  void searchAndAddToCart(line, 1);
}
function setAllGroceryLineChecks(checked) {
  document.querySelectorAll("#generated-list .grocery-line-check").forEach((el) => {
    el.checked = checked;
  });
  syncAddAllToCartToolbar();
}
async function addAllGroceryToCart() {
  if (!getAutoAddEnabled()) {
    alert(
      'Turn on "Automatically pick a product" first. Then you can add every grocery line at once using your chosen strategy.'
    );
    return;
  }
  const lines = parseGroceryLines(appState.lastGeneratedText);
  if (!lines.length) {
    alert("No grocery lines to add. Generate a list first.");
    return;
  }
  setBulkCartButtonsDisabled(true);
  try {
    const { added, failed } = await bulkAddGroceryLines(lines);
    if (failed) {
      alert(
        "Finished: " + added + " line(s) added to cart. " + failed + " line(s) were not added (see earlier messages)."
      );
    }
    showBulkAddKrogerFollowup(added, failed);
  } finally {
    setBulkCartButtonsDisabled(false);
    syncAddAllToCartToolbar();
  }
}
async function addSelectedGroceryToCart() {
  if (!getAutoAddEnabled()) {
    alert(
      'Turn on "Automatically pick a product" first. Then you can add checked lines using your chosen strategy.'
    );
    return;
  }
  const lines = getCheckedGroceryLinesFromDom();
  if (!lines.length) {
    alert('No lines are checked. Use the checkboxes on each row, or click "Check all".');
    return;
  }
  setBulkCartButtonsDisabled(true);
  try {
    const { added, failed } = await bulkAddGroceryLines(lines);
    if (failed) {
      alert(
        "Finished: " + added + " selected line(s) added to cart. " + failed + " line(s) were not added (see earlier messages)."
      );
    }
    showBulkAddKrogerFollowup(added, failed);
  } finally {
    setBulkCartButtonsDisabled(false);
    syncAddAllToCartToolbar();
  }
}
async function generateGroceryList() {
  const btn = document.getElementById("generateBtn");
  const out = document.getElementById("generated");
  if (!out || !btn) return;
  out.style.display = "block";
  out.innerHTML = '<pre class="generated-text">Connecting...</pre>';
  const pre = out.querySelector("pre");
  btn.disabled = true;
  let modelHint = "Qwen/Qwen2.5-7B-Instruct";
  const slowHintId = setTimeout(() => {
    if (pre && pre.textContent === "Connecting...") {
      pre.textContent = "Connecting\u2026\n\nStill waiting? The API host (deploy-config apiOrigin) needs FEATHERLESS_API_KEY and must route " + (tryGetPublicConfig()?.llmProxyPrefix ?? "/llm-api") + " to Express. Check LLM_MODEL on the server and your Featherless plan. Docs: https://featherless.ai/docs/overview";
    }
  }, 15e3);
  try {
    await ensurePublicConfig();
    const llmPrefixEarly = getLlmProxyPrefix();
    await assertApiLlmReadyForFeatherless(llmPrefixEarly);
    const pub = tryGetPublicConfig();
    if (pub?.authRequired) {
      const me = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
      if (!me.ok) {
        clearTimeout(slowHintId);
        out.style.display = "none";
        btn.disabled = false;
        alert("Sign in or create an account (buttons in the header) to generate a meal plan.");
        return;
      }
    }
    const llmModel = getLlmModel();
    const llmPrefix = getLlmProxyPrefix();
    modelHint = llmModel;
    const prefs = readMealPlanPrefsFromForm();
    persistMealPlanPrefs(prefs);
    const prompt = buildMealPlanPrompt(prefs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6e5);
    const response = await fetch(
      getAppOrigin() + llmPrefix + "/api/chat",
      mergeAppAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: llmModel,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          options: { num_predict: mealPlanNumPredict(prefs) }
        }),
        signal: controller.signal
      })
    );
    clearTimeout(timeoutId);
    clearTimeout(slowHintId);
    const respCt = (response.headers.get("content-type") || "").toLowerCase();
    if (response.ok && respCt.includes("text/html")) {
      throw new Error(
        "Meal-plan POST returned HTML (content-type text/html). `apiOrigin` is probably the static website; the request never reached Express. Point apiOrigin at the API host and route " + llmPrefix + "/api/chat to Node."
      );
    }
    if (!response.ok) {
      const body = await response.text();
      let detail = "LLM request failed (HTTP " + response.status + ")";
      try {
        const json = JSON.parse(body);
        if (typeof json.error_description === "string" && json.error_description.trim()) {
          detail = json.error_description.trim();
        } else if (typeof json.error === "string" && json.error.trim()) {
          detail = json.error.trim();
        }
      } catch {
      }
      throw new Error(detail);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof obj.error === "string" && obj.error.trim()) {
          throw new Error(obj.error.trim());
        }
        const content = obj.message?.content;
        if (content) {
          text += content;
          if (pre) {
            pre.textContent = text;
            pre.scrollTop = pre.scrollHeight;
          }
        }
      }
    }
    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer);
        if (typeof obj.error === "string" && obj.error.trim()) {
          throw new Error(obj.error.trim());
        }
        if (obj.message?.content) text += obj.message.content;
      } catch (e) {
        if (e instanceof Error && e.message && !/^Unexpected token/i.test(e.message)) {
          throw e;
        }
      }
    }
    if (pre) pre.textContent = text;
    renderGeneratedResult(text);
  } catch (err) {
    clearTimeout(slowHintId);
    console.error(err);
    const model = getLlmModel();
    const raw = err instanceof Error ? err.message : String(err);
    let msg;
    if (err instanceof Error && err.name === "AbortError") {
      msg = "Request timed out after 10 minutes. Try lowering LLM_MODEL size or simplifying the meal-plan prompt.";
    } else {
      msg = "Error: " + raw;
      const looksLikeLlmOrNetwork = /ECONNREFUSED|ENOTFOUND|fetch failed|502|model|Featherless|featherless/i.test(raw) || /HTTP 5/.test(raw) && !/DYNAMODB|subscription/i.test(raw);
      const isAuthOrBillingGate = /DYNAMODB_USERS_TABLE|subscription is required|SUBSCRIPTION_REQUIRED|Unauthorized|Missing Cognito|Invalid or expired token/i.test(
        raw
      );
      if (looksLikeLlmOrNetwork && !isAuthOrBillingGate) {
        msg += "\n\nFeatherless.ai: confirm FEATHERLESS_API_KEY on the API server, LLM_MODEL matches a model you can run, outbound HTTPS to api.featherless.ai is allowed, and your CDN forwards " + getLlmProxyPrefix() + " to Express. See https://featherless.ai/docs/overview";
        if (/capacity|exhausted/i.test(raw) && (tryGetPublicConfig()?.llmModelOptions.length ?? 0) >= 2) {
          msg += "\n\nIf another model is listed under \u201CMeal-plan model\u201D, select it and generate again.";
        }
      } else if (/DYNAMODB_USERS_TABLE|Subscription checks require/i.test(raw)) {
        msg += "\n\nEither set DYNAMODB_USERS_TABLE in .env (and create the table), or set SUBSCRIPTION_REQUIRED=false if you are not using Stripe subscriptions yet.";
      }
    }
    out.textContent = msg;
  } finally {
    btn.disabled = false;
  }
}

// client/kroger-store-url.ts
function extractKrogerStoreIdFromUserInput(raw) {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  let href = s;
  if (!/^https?:\/\//i.test(href)) {
    if (/kroger\.com/i.test(href)) {
      href = href.replace(/^\/+/, "");
      if (!/^https?:\/\//i.test(href)) href = "https://" + href;
    }
  }
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    if (host !== "kroger.com" && !host.endsWith(".kroger.com")) return null;
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) return last;
  } catch {
    return null;
  }
  return null;
}
function readSavedKrogerLocationOverride() {
  try {
    const v = localStorage.getItem(SAVED_KROGER_LOCATION_ID_KEY);
    return v != null && v.trim() !== "" ? v.trim() : "";
  } catch {
    return "";
  }
}
function writeSavedKrogerLocationOverride(id) {
  try {
    const t = id.trim();
    if (t) localStorage.setItem(SAVED_KROGER_LOCATION_ID_KEY, t);
    else localStorage.removeItem(SAVED_KROGER_LOCATION_ID_KEY);
  } catch {
  }
}
function clearSavedKrogerLocationOverride() {
  try {
    localStorage.removeItem(SAVED_KROGER_LOCATION_ID_KEY);
  } catch {
  }
}

// client/kroger-location-ui.ts
function deployDefaultLocationId() {
  return (tryGetPublicConfig()?.krogerLocationId ?? "").trim();
}
function syncKrogerLocationStatus() {
  const status = document.getElementById("krogerLocationStatus");
  const clearBtn = document.getElementById("krogerStoreClearBtn");
  if (!status) return;
  const override = readSavedKrogerLocationOverride();
  const effective = getKrogerLocationId();
  const fallback = deployDefaultLocationId();
  if (effective) {
    if (override) {
      status.textContent = "Using store " + effective + " (from your link). Product search and prices use this location.";
    } else if (fallback) {
      status.textContent = "Using store " + effective + " from site configuration. Paste a store URL below to override.";
    } else {
      status.textContent = "Using store " + effective + ".";
    }
  } else {
    status.textContent = "No store selected \u2014 search may omit local pricing. Paste a Kroger store page URL (or a numeric store id) and click Apply.";
  }
  if (clearBtn) {
    clearBtn.hidden = !override;
  }
}
function applyKrogerStoreFromInput() {
  const input = document.getElementById("krogerStoreUrlInput");
  if (!input) return;
  const parsed = extractKrogerStoreIdFromUserInput(input.value);
  if (!parsed) {
    alert(
      "Could not find a store id. Paste a full URL like https://www.kroger.com/stores/grocery/\u2026/00513 or enter digits only (e.g. 00513)."
    );
    return;
  }
  writeSavedKrogerLocationOverride(parsed);
  input.value = "";
  syncKrogerLocationStatus();
}
function initKrogerLocationUi() {
  const applyBtn = document.getElementById("krogerStoreApplyBtn");
  const clearBtn = document.getElementById("krogerStoreClearBtn");
  const input = document.getElementById("krogerStoreUrlInput");
  syncKrogerLocationStatus();
  applyBtn?.addEventListener("click", () => applyKrogerStoreFromInput());
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyKrogerStoreFromInput();
    }
  });
  clearBtn?.addEventListener("click", () => {
    clearSavedKrogerLocationOverride();
    syncKrogerLocationStatus();
  });
}

// client/llm-model-ui.ts
function mealPlanOptionsEl() {
  return document.getElementById("mealPlanOptions");
}
function ensureLlmModelRowDom() {
  const container = mealPlanOptionsEl();
  if (!container) return null;
  let row = document.getElementById("llmModelRow");
  let sel = document.getElementById("llmModelSelect");
  if (row && sel) {
    return { row, sel };
  }
  if (row && !sel) {
    row.remove();
    row = null;
  }
  row = document.createElement("div");
  row.className = "meal-plan-row meal-plan-row--full";
  row.id = "llmModelRow";
  const label = document.createElement("label");
  label.setAttribute("for", "llmModelSelect");
  label.textContent = "Meal-plan model";
  sel = document.createElement("select");
  sel.id = "llmModelSelect";
  sel.setAttribute("aria-describedby", "llmModelHint");
  const hint = document.createElement("p");
  hint.id = "llmModelHint";
  hint.className = "meal-plan-hint";
  hint.textContent = "Choose another model if you see a capacity error.";
  row.appendChild(label);
  row.appendChild(sel);
  row.appendChild(hint);
  container.appendChild(row);
  return { row, sel };
}
function initLlmModelSelector() {
  const cfg = tryGetPublicConfig();
  if (!cfg) return;
  const options = cfg.llmModelOptions;
  const dom = ensureLlmModelRowDom();
  if (!dom) return;
  const { row, sel } = dom;
  if (options.length < 2) {
    row.hidden = true;
    sel.replaceChildren();
    return;
  }
  row.hidden = false;
  sel.replaceChildren();
  for (const id of options) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    sel.appendChild(opt);
  }
  let initial = cfg.llmModel;
  try {
    const saved = localStorage.getItem(SAVED_LLM_MODEL_KEY);
    if (saved && options.includes(saved)) initial = saved;
  } catch {
  }
  if (!options.includes(initial)) initial = options[0];
  sel.value = initial;
  sel.addEventListener("change", () => {
    try {
      localStorage.setItem(SAVED_LLM_MODEL_KEY, sel.value);
    } catch {
    }
  });
}

// client/kroger-cart.ts
async function isAppSignedIn() {
  const cfg = tryGetPublicConfig();
  if (!cfg) return false;
  if (cfg.cookieSessionAuth) {
    try {
      const r = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
      return r.ok;
    } catch {
      return false;
    }
  }
  return Boolean(getCognitoAccessToken());
}
async function updateAccountBar() {
  const bar = document.getElementById("accountAppBar");
  const btnIn = document.getElementById("btnAppSignIn");
  const btnOut = document.getElementById("btnAppSignOut");
  const btnSub = document.getElementById("btnSubscribe");
  const btnPortal = document.getElementById("btnBillingPortal");
  const statusEl = document.getElementById("accountStatus");
  const cfg = tryGetPublicConfig();
  if (!bar || !cfg) return;
  const canAppSignIn = Boolean(cfg.cognitoDomain && cfg.cognitoClientId);
  if (!cfg.authRequired && !canAppSignIn) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "";
  const signedIn = await isAppSignedIn();
  const showAuthCtas = !signedIn && (cfg.authRequired || canAppSignIn);
  if (btnIn) btnIn.style.display = showAuthCtas ? "inline-block" : "none";
  const btnUp = document.getElementById("btnAppSignUp");
  if (btnUp) btnUp.style.display = showAuthCtas && canAppSignIn ? "inline-block" : "none";
  if (btnOut) btnOut.style.display = signedIn ? "inline-block" : "none";
  if (btnSub) btnSub.style.display = signedIn && cfg.subscriptionRequired ? "inline-block" : "none";
  if (btnPortal) btnPortal.style.display = signedIn ? "inline-block" : "none";
  if (statusEl) {
    if (!signedIn) {
      statusEl.textContent = "";
    } else {
      try {
        const r = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
        const j = await r.json();
        if (r.ok && j.subscriptionStatus) {
          statusEl.textContent = "Plan: " + j.subscriptionStatus;
        } else {
          statusEl.textContent = "";
        }
      } catch {
        statusEl.textContent = "";
      }
    }
  }
  const adminLink = document.getElementById("adminLink");
  if (adminLink) {
    adminLink.style.display = "none";
    if (signedIn && cfg.authRequired) {
      try {
        const ar = await fetch(apiUrl("/api/admin/status"), mergeAppAuth({ method: "GET" }));
        if (ar.ok) {
          const aj = await ar.json();
          if (aj.admin) adminLink.style.display = "";
        }
      } catch {
      }
    }
  }
}
async function signOutApp() {
  const cfg = tryGetPublicConfig();
  try {
    if (cfg?.cookieSessionAuth) {
      await fetch(apiUrl("/api/auth/session"), mergeAppAuth({ method: "DELETE" }));
    }
  } catch {
  }
  clearCognitoSession();
  window.location.reload();
}
function goAppSignIn() {
  window.location.href = "/auth.html";
}
function goAppSignUp() {
  window.location.href = "/auth.html?signup=1";
}
function isAuthFlowPath() {
  const path = window.location.pathname || "";
  return path.endsWith("/auth.html") || path.endsWith("/auth-callback.html");
}
async function init() {
  loadStoredKrogerAppToken();
  initMealPlanForm();
  initAutoCartPreferencesUi();
  let cfg = null;
  try {
    cfg = await ensurePublicConfig();
    initLlmModelSelector();
  } catch (e) {
    console.error("Public config failed:", e);
    const boot = document.getElementById("bootError");
    if (boot) {
      boot.hidden = false;
      boot.textContent = "Could not load deploy-config.json from this site. Add deploy-config.json next to index.html (copy deploy-config.sample.json) and ensure apiOrigin points at your API when UI and API are on different hosts.";
    }
  }
  initKrogerLocationUi();
  if (cfg && cfg.authRequired && !isAuthFlowPath()) {
    const signedIn = await isAppSignedIn();
    if (!signedIn) {
      if (!cfg.authAllowAnonymousBrowsing) {
        window.location.href = "/";
        return;
      }
    } else {
      try {
        const r = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
        if (r.status === 401) {
          clearCognitoSession();
          window.location.href = "/";
          return;
        }
      } catch {
      }
    }
  }
  const guestBanner = document.getElementById("authBrowseBanner");
  if (guestBanner) {
    const signedInGuest = await isAppSignedIn();
    const showGuest = Boolean(cfg?.authRequired && cfg.authAllowAnonymousBrowsing && !signedInGuest);
    guestBanner.hidden = !showGuest;
  }
  if (localStorage.getItem(SAVED_LLM_KEY)) {
    const loadBtn = document.getElementById("loadSavedBtn");
    if (loadBtn) loadBtn.style.display = "";
  }
  const loadExampleBtn = document.getElementById("loadExampleBtn");
  if (loadExampleBtn) {
    loadExampleBtn.hidden = !cfg?.testMode;
  }
  if (cfg?.cookieSessionAuth) {
    await refreshKrogerLinkedFromApi();
  }
  updateSignInUI();
  const redirectEl = document.getElementById("redirectUriDisplay");
  if (redirectEl) {
    const c = tryGetPublicConfig();
    redirectEl.textContent = c?.krogerRedirectUri || window.location.origin + "/kroger-oauth-callback.html";
    if (c && !c.krogerClientId) {
      redirectEl.textContent += " (set KROGER_CLIENT_ID on the server)";
    }
  }
  await syncCheckoutIfNeeded();
  await updateAccountBar();
}
async function syncCheckoutIfNeeded() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    const sessionId = params.get("session_id");
    if (!sessionId) return;
    const res = await fetch(
      apiUrl("/api/billing/sync-checkout"),
      mergeAppAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      })
    );
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || "Could not confirm subscription (HTTP " + res.status + ")";
      console.warn("Checkout sync failed:", msg);
      alert(msg);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    url.searchParams.delete("session_id");
    const q = url.searchParams.toString();
    window.history.replaceState({}, "", url.pathname + (q ? "?" + q : "") + url.hash);
  } catch (e) {
    console.warn("syncCheckoutIfNeeded", e);
  }
}
window.signInWithKroger = signInWithKroger;
window.signOutKroger = signOutKroger;
window.addItem = addItem;
window.closeProductPicker = closeProductPicker;
window.generateGroceryList = generateGroceryList;
window.loadExampleMealPlan = loadExampleMealPlan;
window.loadSavedLLM = loadSavedLLM;
window.saveLLMToStorage = saveLLMToStorage;
window.copyGroceryListToClipboard = copyGroceryListToClipboard;
window.addAllGroceryToCart = addAllGroceryToCart;
window.addSelectedGroceryToCart = addSelectedGroceryToCart;
window.setAllGroceryLineChecks = setAllGroceryLineChecks;
window.addSuggestedItem = addSuggestedItem;
window.pickProductAndAdd = pickProductAndAdd;
window.showProductMetadata = showProductMetadata;
window.closeProductMetadata = closeProductMetadata;
window.signOutApp = signOutApp;
window.goAppSignIn = goAppSignIn;
window.goAppSignUp = goAppSignUp;
window.subscribeToPlan = subscribeToPlan;
window.openBillingPortal = openBillingPortal;
window.dismissKrogerBulkDoneBanner = dismissKrogerBulkDoneBanner;
void init();
