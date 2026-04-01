import { appState } from "./app-state.js";
import { mergeAppAuth } from "./authed-fetch.js";
import { SAVED_LLM_KEY } from "./config.js";
import {
  apiUrl,
  ensurePublicConfig,
  getAppOrigin,
  getLlmProxyPrefix,
  tryGetPublicConfig,
} from "./public-config.js";
import { escapeHtml, isIngredientLabelForCart, parseGroceryLines } from "./html-utils.js";
import {
  buildMealPlanPrompt,
  mealPlanNumPredict,
  persistMealPlanPrefs,
  readMealPlanPrefsFromForm,
} from "./meal-plan.js";
import type { LlmStreamLine } from "./types.js";
import { EXAMPLE_MEAL_PLAN_TEXT } from "./example-meal-plan.js";
import { showBulkAddKrogerFollowup } from "./kroger-app-launch.js";
import { searchAndAddToCart } from "./add-to-cart.js";
import { getAutoAddEnabled } from "./auto-cart-prefs.js";
import { syncAddAllToCartToolbar } from "./auto-cart-ui.js";

const BULK_ADD_DELAY_MS = 400;

interface IngredientJsonItem {
  label?: string;
  name?: string;
  quantity?: number;
  unit?: string;
}

interface IngredientsJsonPayload {
  ingredients?: IngredientJsonItem[];
}

interface PlanJsonMeal {
  dishId?: string;
  type?: string;
  name?: string;
  notes?: string;
  ingredients?: IngredientJsonItem[];
  steps?: string[];
}

interface PlanJsonDay {
  day?: number;
  label?: string;
  meals?: PlanJsonMeal[];
}

interface PlanJsonRoot {
  days?: PlanJsonDay[];
  grocery?: IngredientsJsonPayload;
}

function extractIngredientLinesFromText(text: string): { lines: string[]; displayText: string } {
  const ingMarker = "INGREDIENTS_JSON:";
  const planMarker = "PLAN_JSON:";
  const ingIdx = text.lastIndexOf(ingMarker);
  const planIdx = text.lastIndexOf(planMarker);

  const firstMarkerIdx =
    ingIdx === -1 && planIdx === -1
      ? -1
      : Math.min(
          ingIdx === -1 ? Number.POSITIVE_INFINITY : ingIdx,
          planIdx === -1 ? Number.POSITIVE_INFINITY : planIdx
        );

  if (firstMarkerIdx === -1) {
    // No structured blocks; fall back to old parser.
    return { lines: parseGroceryLines(text), displayText: text };
  }

  const before = text.slice(0, firstMarkerIdx).trimEnd();

  let ingredientLines: string[] | null = null;
  if (ingIdx !== -1) {
    const afterIng = text.slice(ingIdx + ingMarker.length);
    const jsonLineMatch = afterIng.match(/^[ \t]*\r?\n?([\s\S]+)$/);
    const jsonRaw = jsonLineMatch ? jsonLineMatch[1].trim() : afterIng.trim();

    try {
      const parsed = JSON.parse(jsonRaw) as IngredientsJsonPayload;
      const items = Array.isArray(parsed.ingredients) ? parsed.ingredients : [];
      const labels: string[] = [];
      for (const item of items) {
        if (!item) continue;
        const label =
          typeof item.label === "string" && item.label.trim()
            ? item.label.trim()
            : typeof item.name === "string" && item.name.trim()
              ? item.name.trim()
              : "";
        if (!label) continue;
        if (!isIngredientLabelForCart(label)) continue;
        labels.push(label);
      }
      if (labels.length) {
        ingredientLines = labels;
      }
    } catch {
      // ignore and fall back below
    }
  }

  if (planIdx !== -1) {
    const afterPlan = text.slice(planIdx + planMarker.length);
    const planMatch = afterPlan.match(/^[ \t]*\r?\n?([\s\S]+)$/);
    const planRaw = planMatch ? planMatch[1].trim() : afterPlan.trim();
    try {
      // Debug: log the raw PLAN_JSON block we are about to parse.
      // eslint-disable-next-line no-console
      console.log("PLAN_JSON raw block:", planRaw);
      const parsedPlan = JSON.parse(planRaw) as PlanJsonRoot;
      // Debug: inspect parsed PLAN_JSON to harden client behavior if needed.
      // eslint-disable-next-line no-console
      console.log("Parsed PLAN_JSON:", parsedPlan);
      appState.mealPlanJson = parsedPlan;
      // If we didn't get ingredient lines from INGREDIENTS_JSON, try grocery.ingredients in PLAN_JSON.
      if (!ingredientLines && parsedPlan?.grocery?.ingredients) {
        const labels: string[] = [];
        for (const item of parsedPlan.grocery.ingredients) {
          if (!item) continue;
          const label =
            typeof item.label === "string" && item.label.trim()
              ? item.label.trim()
              : typeof item.name === "string" && item.name.trim()
                ? item.name.trim()
                : "";
          if (!label) continue;
          if (!isIngredientLabelForCart(label)) continue;
          labels.push(label);
        }
        if (labels.length) {
          ingredientLines = labels;
        }
      }
    } catch {
      // ignore PLAN_JSON parse errors; keep going
    }
  }

  if (ingredientLines && ingredientLines.length) {
    // Use JSON-derived labels for cart, drop the structured blocks from the visible text.
    return { lines: ingredientLines, displayText: before || text };
  }

  // Fallback: still hide the structured tail from the visible text, and only parse grocery
  // lines from the human-readable portion (exclude any JSON blobs).
  const parsedFallback = parseGroceryLines(before || text);
  return { lines: parsedFallback, displayText: before || text };
}

/**
 * Confirms `apiOrigin` hits Express (JSON /api/health) and the server has a Featherless key.
 * Uses a simple fetch (no app cookies) so it works before sign-in.
 */
async function assertApiLlmReadyForFeatherless(llmPrefix: string): Promise<void> {
  const healthUrl = apiUrl("/api/health");
  let res: Response;
  try {
    res = await fetch(healthUrl, { cache: "no-store" });
  } catch {
    return;
  }
  const raw = await res.text();
  let h: { ok?: boolean; featherlessKeyConfigured?: boolean };
  try {
    h = JSON.parse(raw) as { ok?: boolean; featherlessKeyConfigured?: boolean };
  } catch {
    throw new Error(
      "GET " +
        healthUrl +
        " did not return JSON. In deploy-config.json set `apiOrigin` to the base URL of your **Node API** (Express), not only the static site. That host must serve /api/health and POST " +
        llmPrefix +
        "/api/chat. If the UI is on www and the API is elsewhere, apiOrigin must point at the API (e.g. your ECS/ALB URL)."
    );
  }
  if (!res.ok || !h.ok) {
    throw new Error("API health check failed at " + healthUrl + " (HTTP " + res.status + ").");
  }
  if (h.featherlessKeyConfigured === false) {
    throw new Error(
      "The API server at " +
        getAppOrigin() +
        " is reachable but FEATHERLESS_API_KEY is not set there. Upstream Featherless is never called until you add the key to the **same** environment that runs this API (e.g. ECS task definition / container secrets), then redeploy."
    );
  }
}

function getCheckedGroceryLinesFromDom(): string[] {
  const list = document.getElementById("generated-list");
  if (!list) return [];
  const out: string[] = [];
  list.querySelectorAll(".grocery-line").forEach((row) => {
    const cb = row.querySelector("input.grocery-line-check") as HTMLInputElement | null;
    if (cb?.checked) {
      const line = row.getAttribute("data-line");
      if (line) out.push(line);
    }
  });
  return out;
}

function setBulkCartButtonsDisabled(disabled: boolean): void {
  for (const id of ["addAllToCartBtn", "addSelectedToCartBtn"]) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.disabled = disabled;
  }
}

async function bulkAddGroceryLines(lines: string[]): Promise<{ added: number; failed: number }> {
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

export function renderGeneratedResult(text: string): void {
  appState.lastGeneratedText = text;
  const out = document.getElementById("generated");
  const cartSection = document.getElementById("add-to-cart-section");
  const listEl = document.getElementById("generated-list");
  if (!out || !cartSection || !listEl) return;
  out.style.display = "block";
  const { lines: ingredientLines, displayText } = extractIngredientLinesFromText(text);
  appState.generatedDisplayText = displayText;
  out.innerHTML =
    '<pre class="generated-text">' +
    escapeHtml(displayText) +
    '</pre><p class="generated-actions">' +
    '<button type="button" onclick="saveLLMToStorage()">Save to storage</button>' +
    '<button type="button" class="btn-secondary" onclick="copyGroceryListToClipboard()">Copy grocery list</button>' +
    '</p><div id="mealRegenerateList" class="meal-regenerate-list"></div>';
  renderMealRegenerateControls();
  const items = ingredientLines;
  if (items.length) {
    listEl.innerHTML = items
      .map(
        (line) =>
          '<div class="grocery-line" data-line="' +
          escapeHtml(line) +
          '">' +
          '<label class="grocery-line__pick">' +
          '<input type="checkbox" class="grocery-line-check" checked ' +
          'aria-label="Include this line when using Add selected to cart" />' +
          "</label>" +
          '<span class="label">' +
          escapeHtml(line) +
          '</span><button type="button" onclick="addSuggestedItem(this)">Add to cart</button></div>'
      )
      .join("");
    cartSection.style.display = "block";
  } else {
    listEl.innerHTML = "";
    cartSection.style.display = "none";
  }
  syncAddAllToCartToolbar();
}

function renderMealRegenerateControls(): void {
  console.log("renderMealRegenerateControls");
  const container = document.getElementById("mealRegenerateList");
  console.log("container", container);
  if (!container) return;
  const plan = appState.mealPlanJson as PlanJsonRoot | null;
  console.log("plan", plan);
  if (!plan || !Array.isArray(plan.days) || !plan.days.length) {
    container.innerHTML = "";
    return;
  }
  const parts: string[] = [];
  console.log("parts", parts);
  parts.push(
    '<div class="meal-regenerate-heading"><h4>Adjust individual meals</h4><p>Select a meal to regenerate a new suggestion that still respects your notes.</p></div>'
  );
  for (const day of plan.days) {
    if (!day || !Array.isArray(day.meals) || !day.meals.length) continue;
    const dayLabel = (day.label || `Day ${day.day ?? ""}`).trim();
    parts.push('<div class="meal-regenerate-day">');
    parts.push('<div class="meal-regenerate-day-label">' + escapeHtml(dayLabel) + "</div>");
    for (const meal of day.meals) {
      if (!meal || !meal.dishId || !meal.name) continue;
      const typeLabel = (meal.type || "").trim();
      const title =
        (typeLabel ? typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1) + ": " : "") +
        meal.name;
      parts.push(
        '<div class="meal-regenerate-row">' +
          '<span class="meal-regenerate-title">' +
          escapeHtml(title) +
          "</span>" +
          '<button type="button" class="meal-regenerate-btn" onclick="regenerateMealByDishId(' +
          "'" +
          String(meal.dishId).replace(/'/g, "\\'") +
          "'" +
          ')">Regenerate</button>' +
          "</div>"
      );
    }
    parts.push("</div>");
  }
  console.log("parts2", parts);
  container.innerHTML = parts.join("");
}

export function regenerateMealByDishId(dishId: string): void {
  if (!dishId) return;
  const plan = appState.mealPlanJson as PlanJsonRoot | null;
  if (!plan || !Array.isArray(plan.days)) {
    alert("Meal plan details are not available yet. Generate a plan first.");
    return;
  }
  void doRegenerateMealByDishId(dishId);
}

async function doRegenerateMealByDishId(dishId: string): Promise<void> {
  const plan = appState.mealPlanJson as PlanJsonRoot | null;
  if (!plan) {
    alert("Meal plan details are not available yet. Generate a plan first.");
    return;
  }
  const notesEl = document.getElementById("mealPlanNotes") as HTMLTextAreaElement | null;
  const notes = (notesEl?.value ?? "").trim();

  const prompt =
    "You are updating an existing meal plan.\n\n" +
    "The current structured plan is below as JSON (PLAN_JSON). You must return an updated PLAN_JSON in exactly the same shape (no extra fields, no comments, no trailing commas, and no additional text before or after the JSON).\n\n" +
    "Existing PLAN_JSON:\n" +
    JSON.stringify(plan) +
    "\n\n" +
    "User dietary notes and preferences (you must continue to respect these strictly):\n" +
    (notes || "(none specified)") +
    "\n\n" +
    "Task:\n" +
    "- Replace exactly one meal whose dishId is \"" +
    dishId +
    '" with a new dish.\n' +
    "- Keep all other days and meals unchanged.\n" +
    "- The new dish should fit the same meal type (breakfast, lunch, or dinner) and feel consistent with the rest of the plan.\n" +
    "- Update the grocery.ingredients array so it reflects the full set of ingredients after this change, with each consolidated ingredient listed exactly once.\n" +
    "- Do not change any other structure, and do not include recipes text or headings—only the updated PLAN_JSON object.\n\n" +
    "Now respond with ONLY the updated PLAN_JSON as a single compact JSON object (no surrounding prose).";

  try {
    await ensurePublicConfig();
    const llmPrefix = getLlmProxyPrefix();
    const pub = tryGetPublicConfig();
    if (pub?.authRequired) {
      const me = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
      if (!me.ok) {
        alert("Sign in or create an account to adjust individual meals.");
        return;
      }
    }
    const response = await fetch(
      getAppOrigin() + llmPrefix + "/api/chat",
      mergeAppAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: { num_predict: 2048 },
        }),
      })
    );
    if (!response.ok) {
      const body = await response.text();
      let detail = "LLM request failed (HTTP " + response.status + ")";
      try {
        const json = JSON.parse(body) as { error?: string; error_description?: string };
        if (typeof json.error_description === "string" && json.error_description.trim()) {
          detail = json.error_description.trim();
        } else if (typeof json.error === "string" && json.error.trim()) {
          detail = json.error.trim();
        }
      } catch {
        /* leave detail as-is */
      }
      throw new Error(detail);
    }
    const raw = await response.text();
    let content = raw.trim();
    try {
      const maybeObj = JSON.parse(raw) as { message?: { content?: string } };
      if (maybeObj && typeof maybeObj === "object" && maybeObj.message?.content) {
        content = String(maybeObj.message.content).trim();
      }
    } catch {
      /* raw might already be the JSON object text */
    }

    let updatedPlan: PlanJsonRoot;
    try {
      updatedPlan = JSON.parse(content) as PlanJsonRoot;
    } catch (e) {
      console.error("Failed to parse updated PLAN_JSON", e, content);
      alert("The model returned an invalid PLAN_JSON. Try again in a moment.");
      return;
    }

    appState.mealPlanJson = updatedPlan;

    const groceryIngredients = updatedPlan.grocery?.ingredients ?? [];
    const ingredientsJson = JSON.stringify({ ingredients: groceryIngredients });
    const baseText =
      appState.generatedDisplayText || appState.lastGeneratedText || appState.lastGeneratedText;
    const newText =
      baseText +
      "\n\nINGREDIENTS_JSON:\n" +
      ingredientsJson +
      "\nPLAN_JSON:\n" +
      JSON.stringify(updatedPlan);
    renderGeneratedResult(newText);
    alert("Meal updated. Review the new ingredients and cart lines.");
  } catch (err) {
    console.error(err);
    const msg =
      err instanceof Error && err.message
        ? err.message
        : "Meal regeneration failed due to an unknown error.";
    alert(msg);
  }
}

export function saveLLMToStorage(): void {
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

export function loadSavedLLM(): void {
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

/** Load bundled sample meal plan + grocery list (no LLM). For testing UI and Kroger add-to-cart. */
export function loadExampleMealPlan(): void {
  renderGeneratedResult(EXAMPLE_MEAL_PLAN_TEXT);
}

export async function copyGroceryListToClipboard(): Promise<void> {
  const { lines } = extractIngredientLinesFromText(appState.lastGeneratedText);
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
    /* fall through */
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

export function addSuggestedItem(btnOrLine: HTMLElement | string): void {
  let line: string | null =
    typeof btnOrLine === "string" ? btnOrLine : btnOrLine.getAttribute("data-line");
  if (!line && typeof btnOrLine !== "string") {
    line = btnOrLine.closest(".grocery-line")?.getAttribute("data-line") ?? null;
  }
  if (!line) return;
  void searchAndAddToCart(line, 1);
}

/** Check or uncheck every grocery line (for bulk add). */
export function setAllGroceryLineChecks(checked: boolean): void {
  document.querySelectorAll("#generated-list .grocery-line-check").forEach((el) => {
    (el as HTMLInputElement).checked = checked;
  });
  syncAddAllToCartToolbar();
}

/** Add every parsed grocery line (quantity 1 each), ignoring checkboxes, when auto-pick is enabled. */
export async function addAllGroceryToCart(): Promise<void> {
  if (!getAutoAddEnabled()) {
    alert(
      'Turn on "Automatically pick a product" first. Then you can add every grocery line at once using your chosen strategy.'
    );
    return;
  }
  const { lines } = extractIngredientLinesFromText(appState.lastGeneratedText);
  if (!lines.length) {
    alert("No grocery lines to add. Generate a list first.");
    return;
  }
  setBulkCartButtonsDisabled(true);
  try {
    const { added, failed } = await bulkAddGroceryLines(lines);
    if (failed) {
      alert(
        "Finished: " +
          added +
          " line(s) added to cart. " +
          failed +
          " line(s) were not added (see earlier messages)."
      );
    }
    showBulkAddKrogerFollowup(added, failed);
  } finally {
    setBulkCartButtonsDisabled(false);
    syncAddAllToCartToolbar();
  }
}

/** Add only checked grocery lines (quantity 1 each) when auto-pick is enabled. */
export async function addSelectedGroceryToCart(): Promise<void> {
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
        "Finished: " +
          added +
          " selected line(s) added to cart. " +
          failed +
          " line(s) were not added (see earlier messages)."
      );
    }
    showBulkAddKrogerFollowup(added, failed);
  } finally {
    setBulkCartButtonsDisabled(false);
    syncAddAllToCartToolbar();
  }
}

export async function generateGroceryList(): Promise<void> {
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
        "Connecting…\n\nStill waiting? The API host (deploy-config apiOrigin) needs FEATHERLESS_API_KEY and must route " +
        (tryGetPublicConfig()?.llmProxyPrefix ?? "/llm-api") +
        " to Express. On the API host, deploy-config.json should list llmModels (try order); without that file use LLM_MODEL. Docs: https://featherless.ai/docs/overview";
    }
  }, 15000);
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
        (btn as HTMLButtonElement).disabled = false;
        alert("Sign in or create an account (buttons in the header) to generate a meal plan.");
        return;
      }
    }
    const llmPrefix = getLlmProxyPrefix();
    const prefs = readMealPlanPrefsFromForm();
    persistMealPlanPrefs(prefs);
    const prompt = buildMealPlanPrompt(prefs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600_000);
    const response = await fetch(
      getAppOrigin() + llmPrefix + "/api/chat",
      mergeAppAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          stream: true,
          options: { num_predict: mealPlanNumPredict(prefs) },
        }),
        signal: controller.signal,
      })
    );
    clearTimeout(timeoutId);
    clearTimeout(slowHintId);
    const respCt = (response.headers.get("content-type") || "").toLowerCase();
    if (response.ok && respCt.includes("text/html")) {
      throw new Error(
        "Meal-plan POST returned HTML (content-type text/html). `apiOrigin` is probably the static website; the request never reached Express. Point apiOrigin at the API host and route " +
          llmPrefix +
          "/api/chat to Node."
      );
    }
    if (!response.ok) {
      const body = await response.text();
      let detail = "LLM request failed (HTTP " + response.status + ")";
      try {
        const json = JSON.parse(body) as { error?: string; error_description?: string };
        if (typeof json.error_description === "string" && json.error_description.trim()) {
          detail = json.error_description.trim();
        } else if (typeof json.error === "string" && json.error.trim()) {
          detail = json.error.trim();
        }
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
        let obj: LlmStreamLine;
        try {
          obj = JSON.parse(line) as LlmStreamLine;
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
        const obj = JSON.parse(buffer) as LlmStreamLine;
        if (typeof obj.error === "string" && obj.error.trim()) {
          throw new Error(obj.error.trim());
        }
        if (obj.message?.content) text += obj.message.content;
      } catch (e) {
        if (e instanceof Error && e.message && !/^Unexpected token/i.test(e.message)) {
          throw e;
        }
        /* ignore trailing parse noise */
      }
    }
    if (pre) pre.textContent = text;
    renderGeneratedResult(text);
  } catch (err) {
    clearTimeout(slowHintId);
    console.error(err);
    const raw = err instanceof Error ? err.message : String(err);
    let msg: string;
    if (err instanceof Error && err.name === "AbortError") {
      msg =
        "Request timed out after 10 minutes. Try simplifying the meal-plan prompt or ask your admin to adjust deploy-config llmModels (or LLM_MODEL) on the API host.";
    } else {
      msg = "Error: " + raw;
      const looksLikeLlmOrNetwork =
        /ECONNREFUSED|ENOTFOUND|fetch failed|502|model|Featherless|featherless/i.test(raw) ||
        (/HTTP 5/.test(raw) && !/DYNAMODB|subscription/i.test(raw));
      const isAuthOrBillingGate =
        /DYNAMODB_USERS_TABLE|subscription is required|SUBSCRIPTION_REQUIRED|Unauthorized|Missing Cognito|Invalid or expired token/i.test(
          raw
        );
      if (looksLikeLlmOrNetwork && !isAuthOrBillingGate) {
        msg +=
          "\n\nFeatherless.ai: confirm FEATHERLESS_API_KEY on the API server, deploy-config llmModels (or LLM_MODEL) lists models your plan can run, outbound HTTPS to api.featherless.ai is allowed, and your CDN forwards " +
          getLlmProxyPrefix() +
          " to Express. See https://featherless.ai/docs/overview";
      } else if (/DYNAMODB_USERS_TABLE|Subscription checks require/i.test(raw)) {
        msg +=
          "\n\nEither set DYNAMODB_USERS_TABLE in .env (and create the table), or set SUBSCRIPTION_REQUIRED=false if you are not using Stripe subscriptions yet.";
      }
    }
    out.textContent = msg;
  } finally {
    (btn as HTMLButtonElement).disabled = false;
  }
}
