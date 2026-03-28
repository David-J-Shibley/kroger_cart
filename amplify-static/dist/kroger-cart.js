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
function getCognitoAccessToken() {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}
function clearCognitoSession() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// client/authed-fetch.ts
function mergeAppAuth(init2 = {}) {
  const token = getCognitoAccessToken();
  const headers = new Headers(init2.headers);
  if (token) {
    headers.set("Authorization", "Bearer " + token.replace(/\s+/g, "").trim());
  }
  return { ...init2, headers };
}
function krogerProxyHeaders(krogerBearerToken) {
  const h = {};
  const t = getCognitoAccessToken();
  if (t) h.Authorization = "Bearer " + t.replace(/\s+/g, "").trim();
  const kb = krogerBearerToken.replace(/^Bearer\s+/i, "").replace(/\s+/g, "").trim();
  h["X-Kroger-Authorization"] = "Bearer " + kb;
  return h;
}

// client/public-config.ts
var cached = null;
var backendOriginCache = null;
async function initBackendOrigin() {
  if (backendOriginCache !== null) return backendOriginCache;
  if (typeof window === "undefined") {
    backendOriginCache = "";
    return "";
  }
  try {
    const r = await fetch("/deploy-config.json", { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const o = j.apiOrigin?.trim().replace(/\/$/, "");
      if (o && /^https?:\/\//i.test(o)) {
        backendOriginCache = o;
        return o;
      }
    }
  } catch {
  }
  backendOriginCache = window.location.origin;
  return backendOriginCache;
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
async function ensurePublicConfig() {
  if (cached) return cached;
  await initBackendOrigin();
  const res = await fetch(apiUrl("/api/public-config"));
  if (!res.ok) {
    throw new Error("Failed to load app configuration (HTTP " + res.status + ")");
  }
  const raw = await res.json();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  cached = {
    krogerClientId: String(raw.krogerClientId ?? ""),
    krogerRedirectUri: String(raw.krogerRedirectUri ?? ""),
    krogerLocationId: String(raw.krogerLocationId ?? ""),
    ollamaModel: String(raw.ollamaModel ?? "qwen3:8b"),
    cognitoDomain: String(raw.cognitoDomain ?? ""),
    cognitoClientId: String(raw.cognitoClientId ?? ""),
    cognitoRedirectUri: String(
      raw.cognitoRedirectUri ?? (origin ? origin + "/auth-callback.html" : "")
    ),
    authRequired: Boolean(raw.authRequired),
    subscriptionRequired: Boolean(raw.subscriptionRequired)
  };
  return cached;
}
function getPublicConfig() {
  if (!cached) {
    throw new Error("App configuration not loaded yet");
  }
  return cached;
}
function tryGetPublicConfig() {
  return cached;
}
function getKrogerLocationId() {
  return tryGetPublicConfig()?.krogerLocationId ?? "";
}
function getOllamaModel() {
  return tryGetPublicConfig()?.ollamaModel ?? "qwen3:8b";
}
function getAppOrigin() {
  return getBackendOrigin();
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

// client/config.ts
var OLLAMA_API_PATH = "/ollama-api";
var SAVED_LLM_KEY = "krogerCartSavedLLM";
var SAVED_MEAL_PREFS_KEY = "krogerCartMealPrefs";

// client/kroger-tokens.ts
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
  return !!getKrogerUserToken() || !!localStorage.getItem("krogerUserRefreshToken");
}
async function getKrogerUserTokenOrRefresh() {
  const token = getKrogerUserToken();
  if (token) return token;
  const refreshToken = localStorage.getItem("krogerUserRefreshToken");
  if (!refreshToken) return null;
  const krogerPath = window.location.protocol === "file:" ? "" : "/kroger-api";
  if (krogerPath !== "/kroger-api") return null;
  try {
    await ensurePublicConfig();
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
  if (signInBtn) signInBtn.style.display = hasUser ? "none" : "";
  if (signedIn) signedIn.style.display = hasUser ? "inline" : "none";
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
function signOutKroger() {
  localStorage.removeItem("krogerUserToken");
  localStorage.removeItem("krogerUserTokenExpiry");
  localStorage.removeItem("krogerUserRefreshToken");
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
  if (/^day\s*\d+\s*$/i.test(s)) return true;
  if (/^meal\s*plan\s+for\s+/i.test(s)) return true;
  return false;
}
function cleanGroceryLine(line) {
  const s = (line || "").replace(/^\*+|\*+$/g, "").trim();
  return s.replace(/^[\-\*•·\d.]+\s*/, "").trim();
}
function parseGroceryLines(text) {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const result = [];
  let inList = false;
  const listHeaders = /^(grocery|shopping|ingredients)\s*list\s*:?\s*\**$/i;
  const looksLikeItem = /^[\-\*•·\d.]+\s*.+$|(\d+\s*(lb|oz|gallon|half-gallon|dozen|eggs?|cans?)\b|,\s*\d+)/i;
  for (const line of lines) {
    const normalized = (line || "").replace(/\*+$/g, "").trim();
    if (listHeaders.test(normalized) || /^(grocery|shopping|ingredients)\s*list\s*:?\s*$/i.test(normalized)) {
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
  const fallback = lines.map((l) => cleanGroceryLine(l)).filter((l) => l.length > 2 && l.length < 120 && !isSectionHeader(l));
  return result.length ? result : fallback;
}
function shortProductName(name) {
  if (!name || typeof name !== "string") return name || "";
  const comma = name.indexOf(",");
  return comma > 0 ? name.slice(0, comma).trim() : name.trim();
}

// client/cart-api.ts
async function addProductToCart(product, quantity2) {
  const userToken = await getKrogerUserTokenOrRefresh();
  if (!userToken) {
    alert("Please sign in with Kroger first.");
    return;
  }
  await ensurePublicConfig();
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
        ...krogerProxyHeaders(userToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(itemData)
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
        alert("An active subscription is required. Use Subscribe in the header.");
        return;
      }
      if (err.code === "AUTH-1007") {
        alert("Cart request was denied. Try signing out and signing in again.");
        return;
      }
      alert("Cart request was denied. Try signing out and signing in again.");
      return;
    }
    if (result.code === "AUTH-1007") {
      alert("Cart request was denied. Try signing out and signing in again.");
      return;
    }
    if (!response.ok) {
      alert(
        "Error adding to cart: " + (result.message || result.code || response.status)
      );
      return;
    }
    displayCart(result);
  } catch (e) {
    console.error(e);
    alert("Error adding to cart: " + (e instanceof Error ? e.message : e));
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
  const res = await fetch(url, { headers: krogerProxyHeaders(bearerToken) });
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
async function addItem() {
  const productEl = document.getElementById("product");
  const qtyEl = document.getElementById("quantity");
  const productName = productEl?.value?.trim() ?? "";
  const quantity2 = parseInt(qtyEl?.value ?? "", 10);
  if (!productName || isNaN(quantity2) || quantity2 <= 0) {
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
    const products2 = await searchKrogerProducts(appToken, searchTerm, 10);
    if (products2.length === 0) {
      alert('No products found for "' + searchTerm + '".');
      return;
    }
    if (products2.length === 1) {
      await addProductToCart(products2[0], quantity2);
      return;
    }
    showProductPicker(products2, quantity2, searchTerm);
  } catch (error) {
    console.error(error);
    alert("Error adding item to cart: " + (error instanceof Error ? error.message : error));
  }
}

// client/meal-plan.ts
function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function defaultMealPlanPrefs() {
  return { people: 3, days: 7, mealScope: "all", notes: "" };
}
function parseStoredMealPrefs(raw) {
  const d = defaultMealPlanPrefs();
  if (!raw) return d;
  try {
    const o = JSON.parse(raw);
    const scope = o.mealScope;
    const mealScope = scope === "lunch_dinner" || scope === "dinner_only" ? scope : "all";
    return {
      people: clampInt(Number(o.people), 1, 16),
      days: clampInt(Number(o.days), 1, 14),
      mealScope,
      notes: typeof o.notes === "string" ? o.notes.slice(0, 800) : ""
    };
  } catch {
    return d;
  }
}
function mealScopeDescription(scope) {
  if (scope === "dinner_only")
    return "For each day list only dinner with specific dish names (no breakfast or lunch).";
  if (scope === "lunch_dinner")
    return "For each day list lunch and dinner only with specific dish names (no breakfast).";
  return "For each day list breakfast, lunch, and dinner with specific dish names.";
}
function buildMealPlanPrompt(prefs) {
  const people = clampInt(prefs.people, 1, 16);
  const days = clampInt(prefs.days, 1, 14);
  const scopeLine = mealScopeDescription(prefs.mealScope);
  const notes = (prefs.notes || "").trim().slice(0, 800);
  const notesBlock = notes ? `

Additional constraints from the user (follow these closely):
${notes}
` : "";
  const dayWord = days === 1 ? "1 day" : `${days} days`;
  const peopleWord = people === 1 ? "1 person" : `${people} people`;
  const listMin = Math.min(50, Math.max(15, 18 + people * 2 + Math.floor(days / 2)));
  const listMax = Math.min(80, Math.max(listMin + 5, 28 + people * 3 + days));
  return `Create a meal plan for ${dayWord} for a household of ${peopleWord}. ${scopeLine} Keep the meal plan brief.${notesBlock}

Then provide ONE consolidated grocery list for the entire period. Rules for the grocery list:
- Scale all quantities for ${peopleWord} across every meal in the plan.
- List each ingredient exactly ONCE. Add up all amounts needed across every recipe and write a single line per ingredient (e.g. "chicken breast, 4 lb" not separate lines for partial amounts).
- Use sensible units: milk and juice in gallons or half-gallons; eggs by count (e.g. "18 eggs"); meat and deli in lb; butter in lb or sticks; flour, sugar, rice in lb; produce in lb or count as appropriate (e.g. "3 onions", "2 lb carrots"); canned goods by count (e.g. "2 (15 oz) cans black beans"). Never use "lb" for liquids like milk.
- Keep the list concise: about ${listMin}\u2013${listMax} line items total (adjust for household size). No duplicate ingredients. No lengthy recipes\u2014just the meal plan and the grocery list.
- Put the grocery list under a clear heading on its own line: "Grocery list:" or "Shopping list:" followed by one item per line.
- Be concise: short meal names and list items only.`;
}
function readMealPlanPrefsFromForm() {
  const peopleEl = document.getElementById("mealPlanPeople");
  const daysEl = document.getElementById("mealPlanDays");
  const scopeEl = document.getElementById("mealPlanScope");
  const notesEl = document.getElementById("mealPlanNotes");
  const scopeRaw = scopeEl?.value;
  const mealScope = scopeRaw === "lunch_dinner" || scopeRaw === "dinner_only" ? scopeRaw : "all";
  return {
    people: clampInt(parseInt(peopleEl?.value ?? "3", 10), 1, 16),
    days: clampInt(parseInt(daysEl?.value ?? "7", 10), 1, 14),
    mealScope,
    notes: (notesEl?.value ?? "").slice(0, 800)
  };
}
function applyMealPlanPrefsToForm(prefs) {
  const peopleEl = document.getElementById("mealPlanPeople");
  const daysEl = document.getElementById("mealPlanDays");
  const scopeEl = document.getElementById("mealPlanScope");
  const notesEl = document.getElementById("mealPlanNotes");
  if (peopleEl) peopleEl.value = String(clampInt(prefs.people, 1, 16));
  if (daysEl) daysEl.value = String(clampInt(prefs.days, 1, 14));
  if (scopeEl) scopeEl.value = prefs.mealScope;
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
  const ids = ["mealPlanPeople", "mealPlanDays", "mealPlanScope", "mealPlanNotes"];
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

// client/grocery-generation.ts
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
      (line) => '<div class="grocery-line"><span class="label">' + escapeHtml(line) + '</span><button type="button" data-line="' + escapeHtml(line) + '" onclick="addSuggestedItem(this)">Add to cart</button></div>'
    ).join("");
    cartSection.style.display = "block";
  } else {
    listEl.innerHTML = "";
    cartSection.style.display = "none";
  }
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
  const line = typeof btnOrLine === "string" ? btnOrLine : btnOrLine.getAttribute("data-line");
  if (!line) return;
  const productEl = document.getElementById("product");
  const qtyEl = document.getElementById("quantity");
  if (productEl && qtyEl) {
    productEl.value = line;
    qtyEl.value = "1";
    void addItem();
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
  let modelHint = "qwen3:8b";
  const slowHintId = setTimeout(() => {
    if (pre && pre.textContent === "Connecting...") {
      pre.textContent = "Connecting...\n\nTaking a while? If you're using Docker, pull the model first:\n  docker exec -it kroger-ollama ollama pull " + modelHint;
    }
  }, 15e3);
  try {
    await ensurePublicConfig();
    const ollamaModel = getOllamaModel();
    modelHint = ollamaModel;
    const prefs = readMealPlanPrefsFromForm();
    persistMealPlanPrefs(prefs);
    const prompt = buildMealPlanPrompt(prefs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6e5);
    const response = await fetch(
      getAppOrigin() + OLLAMA_API_PATH + "/api/chat",
      mergeAppAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          options: { num_predict: 2048 }
        }),
        signal: controller.signal
      })
    );
    clearTimeout(timeoutId);
    clearTimeout(slowHintId);
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
        try {
          const obj = JSON.parse(line);
          const content = obj.message?.content;
          if (content) {
            text += content;
            if (pre) {
              pre.textContent = text;
              pre.scrollTop = pre.scrollHeight;
            }
          }
        } catch {
        }
      }
    }
    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer);
        if (obj.message?.content) text += obj.message.content;
      } catch {
      }
    }
    if (pre) pre.textContent = text;
    renderGeneratedResult(text);
  } catch (err) {
    clearTimeout(slowHintId);
    console.error(err);
    const model = getOllamaModel();
    const raw = err instanceof Error ? err.message : String(err);
    let msg;
    if (err instanceof Error && err.name === "AbortError") {
      msg = "Request timed out after 10 minutes. Try a smaller model or shorter prompt. In Docker, ensure the model is pulled: docker exec -it kroger-ollama ollama pull " + model;
    } else {
      msg = "Error: " + raw;
      const looksLikeOllamaOrNetwork = /ECONNREFUSED|ENOTFOUND|fetch failed|Cannot reach Ollama|502|model|pull/i.test(raw) || /HTTP 5/.test(raw) && !/DYNAMODB|subscription/i.test(raw);
      const isAuthOrBillingGate = /DYNAMODB_USERS_TABLE|subscription is required|SUBSCRIPTION_REQUIRED|Unauthorized|Missing Cognito|Invalid or expired token/i.test(
        raw
      );
      if (looksLikeOllamaOrNetwork && !isAuthOrBillingGate) {
        msg += "\n\nMake sure Ollama is running and the model '" + model + "' is pulled. In Docker: docker exec -it kroger-ollama ollama pull " + model;
      } else if (/DYNAMODB_USERS_TABLE|Subscription checks require/i.test(raw)) {
        msg += "\n\nEither set DYNAMODB_USERS_TABLE in .env (and create the table), or set SUBSCRIPTION_REQUIRED=false if you are not using Stripe subscriptions yet.";
      } else if (/subscription is required|SUBSCRIPTION_REQUIRED/i.test(raw)) {
        msg += "\n\nSubscribe via the app header, or set SUBSCRIPTION_REQUIRED=false for local dev.";
      }
    }
    out.textContent = msg;
  } finally {
    btn.disabled = false;
  }
}

// client/kroger-cart.ts
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
  const tok = getCognitoAccessToken();
  if (btnIn) btnIn.style.display = tok ? "none" : "inline-block";
  if (btnOut) btnOut.style.display = tok ? "inline-block" : "none";
  if (btnSub) btnSub.style.display = tok && cfg.subscriptionRequired ? "inline-block" : "none";
  if (btnPortal) btnPortal.style.display = tok ? "inline-block" : "none";
  if (statusEl) {
    if (!tok) {
      statusEl.textContent = "";
      return;
    }
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
  const adminLink = document.getElementById("adminLink");
  if (adminLink) {
    adminLink.style.display = "none";
    if (tok && cfg.authRequired) {
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
function signOutApp() {
  clearCognitoSession();
  window.location.reload();
}
function goAppSignIn() {
  window.location.href = "/auth.html";
}
function isAuthFlowPath() {
  const path = window.location.pathname || "";
  return path.endsWith("/auth.html") || path.endsWith("/auth-callback.html");
}
async function init() {
  loadStoredKrogerAppToken();
  initMealPlanForm();
  let cfg = null;
  try {
    cfg = await ensurePublicConfig();
  } catch (e) {
    console.error("Public config failed:", e);
    const boot = document.getElementById("bootError");
    if (boot) {
      boot.hidden = false;
      boot.textContent = "Could not load server configuration (/api/public-config). The app cannot enforce sign-in until the server is reachable. If you use Docker, ensure the app container loads your .env (see docker-compose env_file).";
    }
  }
  if (cfg && cfg.authRequired && !isAuthFlowPath()) {
    const tok = getCognitoAccessToken();
    if (!tok) {
      window.location.href = "/auth.html";
      return;
    }
    try {
      const r = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
      if (r.status === 401) {
        clearCognitoSession();
        window.location.href = "/auth.html";
        return;
      }
    } catch {
    }
  }
  if (localStorage.getItem(SAVED_LLM_KEY)) {
    const loadBtn = document.getElementById("loadSavedBtn");
    if (loadBtn) loadBtn.style.display = "";
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
window.loadSavedLLM = loadSavedLLM;
window.saveLLMToStorage = saveLLMToStorage;
window.copyGroceryListToClipboard = copyGroceryListToClipboard;
window.addSuggestedItem = addSuggestedItem;
window.pickProductAndAdd = pickProductAndAdd;
window.showProductMetadata = showProductMetadata;
window.closeProductMetadata = closeProductMetadata;
window.signOutApp = signOutApp;
window.goAppSignIn = goAppSignIn;
window.subscribeToPlan = subscribeToPlan;
window.openBillingPortal = openBillingPortal;
void init();
