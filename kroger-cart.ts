/**
 * Kroger Shopping Cart — client script.
 * Build: npm run build:client
 * Then open kroger-cart.html (script loads dist/kroger-cart.js).
 */

// --- Config (replace with your credentials) ---
const CLIENT_ID = "";
const CLIENT_SECRET = "";
const KROGER_REDIRECT_URI = "http://localhost:8000/kroger-oauth-callback.html";

const OLLAMA_URL = "http://localhost:8000";
const OLLAMA_API_PATH = "/ollama-api";
const OLLAMA_MODEL = "qwen3:8b";

const SAVED_LLM_KEY = "krogerCartSavedLLM";
const KROGER_LOCATION_ID = "62000062";

const MEAL_PLAN_PROMPT = `Create a meal plan for one week (7 days) for a family of three (3 people). For each day list breakfast, lunch, and dinner with specific dish names. Keep the meal plan brief.

Then provide ONE consolidated grocery list for the whole week. Rules for the grocery list:
- List each ingredient exactly ONCE. Add up all amounts needed across every recipe and write a single line per ingredient (e.g. "chicken breast, 4 lb" not "chicken breast 1 lb" and "chicken breast 2 lb" on separate lines).
- Use sensible units: milk and juice in gallons or half-gallons; eggs by count (e.g. "18 eggs"); meat and deli in lb; butter in lb or sticks; flour, sugar, rice in lb; produce in lb or count as appropriate (e.g. "3 onions", "2 lb carrots"); canned goods by count (e.g. "2 (15 oz) cans black beans"). Never use "lb" for liquids like milk.
- Keep the list concise: 25–45 line items total. No duplicate ingredients. No lengthy recipes—just the meal plan and the grocery list.
- Put the grocery list under a clear heading on its own line: "Grocery list:" or "Shopping list:" followed by one item per line.
- Be concise: short meal names and list items only.`;

// --- Types ---
interface KrogerProduct {
  upc: string;
  productId: string;
  name: string;
  price: number;
}

/** Product + full raw response from Kroger API (for metadata display). */
interface PickerProduct extends KrogerProduct {
  raw?: Record<string, unknown>;
}

interface KrogerCartItem {
  product: { name: string; price: number };
  quantity: number;
}

interface KrogerCartResponse {
  items?: KrogerCartItem[];
  code?: string;
  message?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface OllamaMessage {
  message?: { content?: string };
}

// --- State ---
let accessToken: string | null = localStorage.getItem("krogerToken");
let lastGeneratedText = "";

// Window extended with picker state and handlers (assigned at end of script)
interface WindowWithPicker extends Window {
  _pickerProducts?: PickerProduct[];
  _pickerProductsOriginal?: PickerProduct[];
  _pickerQuantity?: number;
  signInWithKroger: () => void;
  signOutKroger: () => void;
  addItem: () => Promise<void>;
  closeProductPicker: () => void;
  generateGroceryList: () => Promise<void>;
  loadSavedLLM: () => void;
  saveLLMToStorage: () => void;
  addSuggestedItem: (btnOrLine: HTMLElement | string) => void;
  pickProductAndAdd: (index: number) => Promise<void>;
  showProductMetadata: (index: number) => void;
  closeProductMetadata: () => void;
}
const win = window as unknown as WindowWithPicker;

// --- Auth / token ---
function clearKrogerToken(): void {
  accessToken = null;
  localStorage.removeItem("krogerToken");
  localStorage.removeItem("tokenExpiry");
}

function getKrogerUserToken(): string | null {
  const token = localStorage.getItem("krogerUserToken");
  const expiry = localStorage.getItem("krogerUserTokenExpiry");
  if (!token) return null;
  const expiryMs = expiry ? parseInt(expiry, 10) : 0;
  if (expiryMs && !Number.isNaN(expiryMs) && Date.now() >= expiryMs) return null;
  return token.replace(/\s+/g, "").trim();
}

/** Returns true if user has a valid token or a refresh token (so we can refresh without re-sign-in). */
function hasKrogerUserSession(): boolean {
  return !!getKrogerUserToken() || !!localStorage.getItem("krogerUserRefreshToken");
}

/** Returns a valid access token, refreshing from refresh_token if expired. Use this before cart/API calls. */
async function getKrogerUserTokenOrRefresh(): Promise<string | null> {
  const token = getKrogerUserToken();
  if (token) return token;
  const refreshToken = localStorage.getItem("krogerUserRefreshToken");
  if (!refreshToken) return null;
  const krogerPath = window.location.protocol === "file:" ? "" : "/kroger-api";
  if (krogerPath !== "/kroger-api") return null; // refresh only when using server proxy
  try {
    const res = await fetch("/kroger-api/oauth-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken: refreshToken.replace(/\s+/g, "").trim(),
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      }),
    });
    const data = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
    if (!res.ok || !data.access_token) {
      localStorage.removeItem("krogerUserRefreshToken");
      localStorage.removeItem("krogerUserToken");
      localStorage.removeItem("krogerUserTokenExpiry");
      return null;
    }
    const newToken = String(data.access_token).replace(/\s+/g, "").trim();
    const expiresIn =
      data.expires_in != null && data.expires_in > 0 ? data.expires_in * 1000 : 3600000;
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

function updateSignInUI(): void {
  const hasUser = hasKrogerUserSession();
  const signInBtn = document.getElementById("krogerSignInBtn");
  const signedIn = document.getElementById("krogerSignedIn");
  if (signInBtn) signInBtn.style.display = hasUser ? "none" : "";
  if (signedIn) signedIn.style.display = hasUser ? "inline" : "none";
}

function signInWithKroger(): void {
  sessionStorage.setItem("krogerOAuthClientId", CLIENT_ID);
  sessionStorage.setItem("krogerOAuthClientSecret", CLIENT_SECRET);
  sessionStorage.setItem("krogerOAuthRedirectUri", KROGER_REDIRECT_URI);
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem("krogerOAuthState", state);
  const scope = "product.compact%20cart.basic%3Awrite";
  const url =
    "https://api.kroger.com/v1/connect/oauth2/authorize?" +
    "client_id=" +
    encodeURIComponent(CLIENT_ID) +
    "&redirect_uri=" +
    encodeURIComponent(KROGER_REDIRECT_URI) +
    "&response_type=code&scope=" +
    scope +
    "&state=" +
    encodeURIComponent(state);
  window.location.href = url;
}

function signOutKroger(): void {
  localStorage.removeItem("krogerUserToken");
  localStorage.removeItem("krogerUserTokenExpiry");
  localStorage.removeItem("krogerUserRefreshToken");
  updateSignInUI();
}

async function getAccessToken(): Promise<string> {
  const expiryRaw = localStorage.getItem("tokenExpiry");
  const expiry = expiryRaw != null ? (JSON.parse(expiryRaw) as number) : null;
  if (accessToken && expiry && Date.now() < expiry) {
    const t = String(accessToken).trim();
    if (t) return t;
  }

  const krogerBase = window.location.protocol === "file:" ? "https://api.kroger.com" : "";
  const krogerPath = window.location.protocol === "file:" ? "" : "/kroger-api";
  const useServerToken = krogerPath === "/kroger-api";
  const response = useServerToken
    ? await fetch(krogerBase + krogerPath + "/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
      })
    : await fetch(krogerBase + krogerPath + "/v1/connect/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(CLIENT_ID + ":" + CLIENT_SECRET),
        },
        body: "grant_type=client_credentials&scope=product.compact",
      });

  const tokenJson = (await response.json()) as TokenResponse;
  if (!tokenJson.access_token) {
    clearKrogerToken();
    throw new Error(
      tokenJson.error_description || tokenJson.error || "Failed to get access token"
    );
  }

  const token = String(tokenJson.access_token).replace(/\s+/g, "").trim();
  if (token.length < 20) {
    clearKrogerToken();
    throw new Error("Token from Kroger was too short or invalid.");
  }
  const expiresIn =
    tokenJson.expires_in != null && tokenJson.expires_in > 0
      ? tokenJson.expires_in * 1000
      : 3600000;
  const expiryMs = Math.min(expiresIn, Math.max(0, expiresIn - 5 * 60 * 1000));
  accessToken = token;
  localStorage.setItem("krogerToken", token);
  localStorage.setItem("tokenExpiry", String(Date.now() + expiryMs));
  return token;
}

// --- HTML / utils ---
function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML.replace(/"/g, "&quot;");
}

function isSectionHeader(line: string): boolean {
  const s = (line || "").replace(/\*+$/g, "").trim();
  if (/^(meal\s*plan|grocery\s*list|shopping\s*list|ingredients\s*list)\s*:?\s*$/i.test(s))
    return true;
  if (/^day\s*\d+\s*$/i.test(s)) return true;
  if (/^meal\s*plan\s+for\s+/i.test(s)) return true;
  return false;
}

function cleanGroceryLine(line: string): string {
  const s = (line || "").replace(/^\*+|\*+$/g, "").trim();
  return s.replace(/^[\-\*•·\d.]+\s*/, "").trim();
}

function parseGroceryLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const result: string[] = [];
  let inList = false;
  const listHeaders = /^(grocery|shopping|ingredients)\s*list\s*:?\s*\**$/i;
  const looksLikeItem =
    /^[\-\*•·\d.]+\s*.+$|(\d+\s*(lb|oz|gallon|half-gallon|dozen|eggs?|cans?)\b|,\s*\d+)/i;
  for (const line of lines) {
    const normalized = (line || "").replace(/\*+$/g, "").trim();
    if (
      listHeaders.test(normalized) ||
      /^(grocery|shopping|ingredients)\s*list\s*:?\s*$/i.test(normalized)
    ) {
      inList = true;
      continue;
    }
    if (isSectionHeader(line)) continue;
    if (inList) {
      const cleaned = cleanGroceryLine(line);
      if (cleaned.length > 1 && !isSectionHeader(cleaned)) result.push(cleaned);
      continue;
    }
    if (looksLikeItem.test(line)) {
      const cleaned = cleanGroceryLine(line);
      if (cleaned.length > 1 && !isSectionHeader(cleaned)) result.push(cleaned);
    }
  }
  const fallback = lines
    .map((l) => cleanGroceryLine(l))
    .filter((l) => l.length > 2 && l.length < 120 && !isSectionHeader(l));
  return result.length ? result : fallback;
}

function shortProductName(name: string): string {
  if (!name || typeof name !== "string") return name || "";
  const comma = name.indexOf(",");
  return comma > 0 ? name.slice(0, comma).trim() : name.trim();
}

// --- Render generated result ---
function renderGeneratedResult(text: string): void {
  lastGeneratedText = text;
  const out = document.getElementById("generated");
  const cartSection = document.getElementById("add-to-cart-section");
  const listEl = document.getElementById("generated-list");
  if (!out || !cartSection || !listEl) return;
  out.style.display = "block";
  out.innerHTML =
    '<pre class="generated-text">' +
    escapeHtml(text) +
    '</pre><p style="margin-top:12px"><button type="button" onclick="saveLLMToStorage()">Save to storage</button></p>';
  const items = parseGroceryLines(text);
  if (items.length) {
    listEl.innerHTML = items
      .map(
        (line) =>
          '<div class="grocery-line"><span class="label">' +
          escapeHtml(line) +
          '</span><button type="button" data-line="' +
          escapeHtml(line) +
          '" onclick="addSuggestedItem(this)">Add to cart</button></div>'
      )
      .join("");
    cartSection.style.display = "block";
  } else {
    listEl.innerHTML = "";
    cartSection.style.display = "none";
  }
}

function saveLLMToStorage(): void {
  if (!lastGeneratedText) return;
  try {
    localStorage.setItem(SAVED_LLM_KEY, lastGeneratedText);
    const loadBtn = document.getElementById("loadSavedBtn");
    if (loadBtn) loadBtn.style.display = "";
    alert('Saved. Use "Load saved" to restore without calling the LLM.');
  } catch (e) {
    alert("Save failed: " + (e instanceof Error ? e.message : e));
  }
}

function loadSavedLLM(): void {
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

function addSuggestedItem(btnOrLine: HTMLElement | string): void {
  const line =
    typeof btnOrLine === "string"
      ? btnOrLine
      : (btnOrLine as HTMLElement).getAttribute("data-line");
  if (!line) return;
  const productEl = document.getElementById("product");
  const qtyEl = document.getElementById("quantity");
  if (productEl && qtyEl) {
    (productEl as HTMLInputElement).value = line;
    (qtyEl as HTMLInputElement).value = "1";
    addItem();
  }
}

async function generateGroceryList(): Promise<void> {
  const btn = document.getElementById("generateBtn");
  const out = document.getElementById("generated");
  if (!out || !btn) return;
  out.style.display = "block";
  out.innerHTML = '<pre class="generated-text">Connecting...</pre>';
  const pre = out.querySelector("pre");
  (btn as HTMLButtonElement).disabled = true;
  const slowHintId = setTimeout(() => {
    if (pre && pre.textContent === "Connecting...") {
      pre.textContent =
        "Connecting...\n\nTaking a while? If you're using Docker, pull the model first:\n  docker exec -it kroger-ollama ollama pull " +
        OLLAMA_MODEL;
    }
  }, 15000);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600_000);
    const response = await fetch(OLLAMA_URL + OLLAMA_API_PATH + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: MEAL_PLAN_PROMPT }],
        stream: true,
        options: { num_predict: 2048 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    clearTimeout(slowHintId);
    if (!response.ok) {
      const body = await response.text();
      let detail = "LLM request failed: " + response.status;
      try {
        const json = JSON.parse(body) as { error?: string };
        if (json.error && typeof json.error === "string") detail = json.error;
      } catch {
        /* use status if body isn't JSON */
      }
      throw new Error(detail);
    }
    const reader = response.body!.getReader();
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
        try {
          const obj = JSON.parse(line) as OllamaMessage;
          const content = obj.message?.content;
          if (content) {
            text += content;
            if (pre) {
              pre.textContent = text;
              pre.scrollTop = pre.scrollHeight;
            }
          }
        } catch {
          /* ignore parse errors on stream chunks */
        }
      }
    }
    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer) as OllamaMessage;
        if (obj.message?.content) text += obj.message.content;
      } catch {
        /* ignore */
      }
    }
    if (pre) pre.textContent = text;
    renderGeneratedResult(text);
  } catch (err) {
    clearTimeout(slowHintId);
    console.error(err);
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "Request timed out after 10 minutes. Try a smaller model or shorter prompt. In Docker, ensure the model is pulled: docker exec -it kroger-ollama ollama pull " +
          OLLAMA_MODEL
        : "Error: " + (err instanceof Error ? err.message : err) +
          "\n\nMake sure Ollama is running and the model '" +
          OLLAMA_MODEL +
          "' is pulled. In Docker: docker exec -it kroger-ollama ollama pull " +
          OLLAMA_MODEL;
    out.textContent = msg;
  } finally {
    (btn as HTMLButtonElement).disabled = false;
  }
}

// --- Kroger product search ---
async function searchKrogerProduct(
  token: string,
  searchTerm: string
): Promise<KrogerProduct | null> {
  const krogerBase = window.location.protocol === "file:" ? "https://api.kroger.com" : "";
  const krogerPath = window.location.protocol === "file:" ? "" : "/kroger-api";
  let url =
    krogerBase +
    krogerPath +
    "/v1/products?filter.term=" +
    encodeURIComponent(searchTerm) +
    "&filter.limit=5";
  if (KROGER_LOCATION_ID) url += "&filter.locationId=" + encodeURIComponent(KROGER_LOCATION_ID);
  const bearerToken = String(token).replace(/\s+/g, "").trim();
  const res = await fetch(url, { headers: { Authorization: "Bearer " + bearerToken } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 || (json.code && String(json.code) === "AUTH-1007")) {
    clearKrogerToken();
    throw new Error("Kroger returned invalid token (AUTH-1007). Check Developer Portal and credentials.");
  }
  if (!res.ok) return null;
  const list = (json.data || json.items || []) as Record<string, unknown>[];
  if (list.length === 0) return null;
  const p = list[0];
  const priceObj =
    (p.items as Record<string, unknown>[])?.[0] != null &&
    (p.items as Record<string, unknown>[])[0] != null &&
    typeof (p.items as Record<string, unknown>[])[0] === "object"
      ? ((p.items as Record<string, unknown>[])[0] as Record<string, unknown>).price
      : p.price != null
        ? { regular: p.price }
        : null;
  const priceObj2 = priceObj as { regular?: number; promo?: number } | null;
  const price = priceObj2?.regular ?? priceObj2?.promo ?? 0;
  return {
    upc: String(p.upc || p.productId || ""),
    productId: String(p.productId || p.upc || ""),
    name: String(p.description || p.productId || searchTerm),
    price: typeof price === "number" ? price : parseFloat(String(price)) || 0,
  };
}

async function searchKrogerProducts(
  token: string,
  searchTerm: string,
  limit: number = 10
): Promise<KrogerProduct[]> {
  const krogerBase = window.location.protocol === "file:" ? "https://api.kroger.com" : "";
  const krogerPath = window.location.protocol === "file:" ? "" : "/kroger-api";
  let url =
    krogerBase +
    krogerPath +
    "/v1/products?filter.term=" +
    encodeURIComponent(searchTerm) +
    "&filter.limit=" +
    limit;
  if (KROGER_LOCATION_ID) url += "&filter.locationId=" + encodeURIComponent(KROGER_LOCATION_ID);
  const bearerToken = String(token).replace(/\s+/g, "").trim();
  const res = await fetch(url, { headers: { Authorization: "Bearer " + bearerToken } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 || (json.code && String(json.code) === "AUTH-1007")) {
    clearKrogerToken();
    throw new Error("Kroger returned invalid token. Try signing in again.");
  }
  if (!res.ok) return [];
  const list = (json.data || json.items || []) as Record<string, unknown>[];
  return list.map((p) => {
    const priceObj =
      (p.items as Record<string, unknown>[])?.[0] != null
        ? ((p.items as Record<string, unknown>[])[0] as Record<string, unknown>).price
        : p.price != null
          ? { regular: p.price }
          : null;
    const priceObj2 = priceObj as { regular?: number; promo?: number } | null;
    const price = priceObj2?.regular ?? priceObj2?.promo ?? 0;
    const product: PickerProduct = {
      upc: String(p.upc || p.productId || ""),
      productId: String(p.productId || p.upc || ""),
      name: String(p.description || p.productId || searchTerm),
      price: typeof price === "number" ? price : parseFloat(String(price)) || 0,
      raw: p,
    };
    return product;
  });
}

// --- Product picker modal ---
function closeProductPicker(): void {
  const modal = document.getElementById("productPickerModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

type PickerSort = "default" | "price-asc" | "price-desc";

function renderProductPickerList(sortBy: PickerSort): void {
  const listEl = document.getElementById("productPickerList");
  const original = win._pickerProductsOriginal;
  if (!listEl || !original || original.length === 0) return;
  let products: PickerProduct[];
  if (sortBy === "price-asc") {
    products = [...original].sort((a, b) => a.price - b.price);
  } else if (sortBy === "price-desc") {
    products = [...original].sort((a, b) => b.price - a.price);
  } else {
    products = [...original];
  }
  win._pickerProducts = products;
  listEl.innerHTML = products
    .map((p, i) => {
      const name = escapeHtml(p.name || "Product " + (i + 1));
      const price = p.price > 0 ? "$" + p.price.toFixed(2) : "Price N/A";
      return (
        '<div class="modal-product">' +
        '<div class="info"><span class="name">' +
        name +
        '</span><br><span class="price">' +
        price +
        '</span></div>' +
        '<div class="modal-product-actions">' +
        '<button type="button" class="btn-meta" data-picker-index="' +
        i +
        '" onclick="showProductMetadata(parseInt(this.getAttribute(\'data-picker-index\'),10))">Metadata</button>' +
        '<button type="button" class="btn-add" data-picker-index="' +
        i +
        '" onclick="pickProductAndAdd(parseInt(this.getAttribute(\'data-picker-index\'),10))">Add to cart</button>' +
        "</div></div>"
      );
    })
    .join("");
}

function showProductPicker(
  products: PickerProduct[],
  quantity: number,
  searchTerm: string
): void {
  const title = document.getElementById("productPickerTitle");
  const toolbarEl = document.getElementById("productPickerToolbar");
  const listEl = document.getElementById("productPickerList");
  const modal = document.getElementById("productPickerModal");
  if (!title || !toolbarEl || !listEl || !modal) return;
  title.textContent = 'Choose a product for "' + (searchTerm || "") + '"';
  win._pickerProducts = [...products];
  win._pickerProductsOriginal = [...products];
  win._pickerQuantity = quantity;

  toolbarEl.innerHTML =
    '<label for="productPickerSortSelect">Sort:</label>' +
    '<select id="productPickerSortSelect" aria-label="Sort by price">' +
    '<option value="default">Default order</option>' +
    '<option value="price-asc">Price: low to high</option>' +
    '<option value="price-desc">Price: high to low</option>' +
    "</select>";
  const sortSelect = document.getElementById("productPickerSortSelect") as HTMLSelectElement | null;
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      renderProductPickerList((sortSelect.value as PickerSort) || "default");
    });
  }

  renderProductPickerList("default");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function showProductMetadata(index: number): void {
  const products = win._pickerProducts;
  const preEl = document.getElementById("productMetadataPre");
  const metaModal = document.getElementById("productMetadataModal");
  if (!products || products[index] == null || !preEl || !metaModal) return;
  const product = products[index];
  // Show full Kroger API response when available, otherwise the normalized product
  const toShow = product.raw != null ? product.raw : product;
  preEl.textContent = JSON.stringify(toShow, null, 2);
  metaModal.classList.remove("hidden");
  metaModal.setAttribute("aria-hidden", "false");
}

function closeProductMetadata(): void {
  const metaModal = document.getElementById("productMetadataModal");
  if (metaModal) {
    metaModal.classList.add("hidden");
    metaModal.setAttribute("aria-hidden", "true");
  }
}

async function pickProductAndAdd(index: number): Promise<void> {
  const products = win._pickerProducts;
  const quantity = win._pickerQuantity;
  if (!products || products[index] == null) return;
  closeProductPicker();
  await addProductToCart(products[index], quantity ?? 1);
}

async function addProductToCart(product: KrogerProduct, quantity: number): Promise<void> {
  const userToken = await getKrogerUserTokenOrRefresh();
  if (!userToken) {
    alert("Please sign in with Kroger first.");
    return;
  }
  const krogerBase = window.location.protocol === "file:" ? "https://api.kroger.com" : "";
  const krogerPath = window.location.protocol === "file:" ? "" : "/kroger-api";
  const cartUrl = krogerBase + krogerPath + "/v1/cart/add";
  const itemData = {
    items: [
      {
        quantity,
        upc: product.upc || undefined,
        productId: product.productId || undefined,
        product: { name: shortProductName(product.name), price: product.price },
      },
    ],
  };
  try {
    const response = await fetch(cartUrl, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + userToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(itemData),
    });
    const text = await response.text();
    const result: KrogerCartResponse = text ? JSON.parse(text) : {};
    if (response.status === 403 || (result.code === "AUTH-1007")) {
      alert("Cart request was denied. Try signing out and signing in again.");
      return;
    }
    if (!response.ok) {
      alert(
        "Error adding to cart: " +
          (result.message || result.code || response.status)
      );
      return;
    }
    displayCart(result);
  } catch (e) {
    console.error(e);
    alert("Error adding to cart: " + (e instanceof Error ? e.message : e));
  }
}

async function addItem(): Promise<void> {
  const productEl = document.getElementById("product");
  const qtyEl = document.getElementById("quantity");
  const productName = (productEl as HTMLInputElement | null)?.value?.trim() ?? "";
  const quantity = parseInt((qtyEl as HTMLInputElement | null)?.value ?? "", 10);

  if (!productName || isNaN(quantity) || quantity <= 0) {
    alert("Please enter valid product name and quantity");
    return;
  }

  const userToken = await getKrogerUserTokenOrRefresh();
  if (!userToken) {
    alert(
      'Please sign in with Kroger first (click "Sign in with Kroger" above) to add items to your cart.'
    );
    return;
  }

  try {
    const appToken = await getAccessToken();
    const searchTerm = shortProductName(productName);
    const products = await searchKrogerProducts(appToken, searchTerm, 10);
    if (products.length === 0) {
      alert('No products found for "' + searchTerm + '".');
      return;
    }
    if (products.length === 1) {
      await addProductToCart(products[0], quantity);
      return;
    }
    showProductPicker(products, quantity, searchTerm);
  } catch (error) {
    console.error(error);
    alert("Error adding item to cart: " + (error instanceof Error ? error.message : error));
  }
}

function displayCart(items: KrogerCartResponse): void {
  const cartDiv = document.getElementById("cart");
  if (!cartDiv) return;
  cartDiv.innerHTML = "";
  if (items?.items && items.items.length > 0) {
    for (const item of items.items) {
      const itemDiv = document.createElement("div");
      itemDiv.textContent =
        `${item.product.name} x${item.quantity} - $${(item.product.price * item.quantity).toFixed(2)}`;
      cartDiv.appendChild(itemDiv);
    }
  } else {
    cartDiv.textContent = "Your cart is empty";
  }
}

// --- Init: attach to window for onclick handlers and run once ---
function init(): void {
  if (localStorage.getItem(SAVED_LLM_KEY)) {
    const loadBtn = document.getElementById("loadSavedBtn");
    if (loadBtn) loadBtn.style.display = "";
  }
  updateSignInUI();
  const redirectEl = document.getElementById("redirectUriDisplay");
  if (redirectEl)
    redirectEl.textContent =
      typeof KROGER_REDIRECT_URI !== "undefined"
        ? KROGER_REDIRECT_URI
        : window.location.origin + "/kroger-oauth-callback.html";
}

window.signInWithKroger = signInWithKroger;
window.signOutKroger = signOutKroger;
window.addItem = addItem;
window.closeProductPicker = closeProductPicker;
window.generateGroceryList = generateGroceryList;
window.loadSavedLLM = loadSavedLLM;
window.saveLLMToStorage = saveLLMToStorage;
window.addSuggestedItem = addSuggestedItem;
window.pickProductAndAdd = pickProductAndAdd;
window.showProductMetadata = showProductMetadata;
window.closeProductMetadata = closeProductMetadata;

init();
