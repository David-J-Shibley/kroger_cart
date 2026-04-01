import { appState, loadStoredKrogerAppToken } from "./app-state.js";
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
  const planMarker = "PLAN_JSON:";
  const planIdx = text.lastIndexOf(planMarker);

  if (planIdx === -1) {
    // No structured block; fall back to old parser on entire text.
    return { lines: parseGroceryLines(text), displayText: text };
  }

  const before = text.slice(0, planIdx).trimEnd();

  let ingredientLines: string[] | null = null;

  if (planIdx !== -1) {
    const afterPlan = text.slice(planIdx + planMarker.length);
    const planMatch = afterPlan.match(/^[ \t]*\r?\n?([\s\S]+)$/);
    let planRaw = planMatch ? planMatch[1].trim() : afterPlan.trim();

    // Strip markdown code fences like ```json ... ``` if present.
    if (planRaw.startsWith("```")) {
      planRaw = planRaw.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```$/, "").trim();
    }

    try {
      const parsedAny = JSON.parse(planRaw) as any;

      // Normalize shape: some models wrap grocery as a separate "day" object.
      let parsedPlan: PlanJsonRoot = parsedAny;
      if (!parsedPlan.grocery && Array.isArray(parsedPlan.days)) {
        const last = parsedPlan.days[parsedPlan.days.length - 1] as any;
        if (last && last.grocery) {
          parsedPlan = {
            days: parsedPlan.days.slice(0, parsedPlan.days.length - 1),
            grocery: last.grocery as IngredientsJsonPayload,
          };
        }
      }

      appState.mealPlanJson = parsedPlan;

      // Use grocery.ingredients in PLAN_JSON as the single source of ingredient lines.
      if (parsedPlan?.grocery?.ingredients) {
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
  // Use the structured plan we parsed earlier (if any) to drive the regenerate UI.
  const plan = appState.mealPlanJson as PlanJsonRoot | null;
  console.log("planShape", Array.isArray(plan?.days), plan);
  if (Array.isArray(plan?.days)) {
    renderMealRegenerateControls(plan);
  } else {
    renderMealRegenerateControls(extractPlanJsonFromText(text));
  }
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

function renderMealRegenerateControls(plan?: PlanJsonRoot): void {
  const container = document.getElementById("mealRegenerateList");
  if (!container) return;
  if (!plan || !Array.isArray(plan.days) || !plan.days.length) {
    container.innerHTML = "";
    return;
  }
  const parts: string[] = [];
  parts.push(
    '<div class="meal-regenerate-heading"><h4>Adjust individual meals</h4><p>Select a meal to regenerate a new suggestion that still respects your notes.</p><p id="mealRegenerateStatus" class="meal-regenerate-status" aria-live="polite"></p></div>'
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
  container.innerHTML = parts.join("");
}

function setMealRegenerateLoading(isLoading: boolean): void {
  const status = document.getElementById("mealRegenerateStatus");
  const buttons = document.querySelectorAll<HTMLButtonElement>(".meal-regenerate-btn");
  if (status) {
    status.textContent = isLoading ? "Regenerating this meal…" : "";
  }
  buttons.forEach((btn) => {
    btn.disabled = isLoading;
  });
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

// Expose for inline onclick handlers in index.html.
(window as unknown as { regenerateMealByDishId?: (dishId: string) => void }).regenerateMealByDishId =
  regenerateMealByDishId;

async function doRegenerateMealByDishId(dishId: string): Promise<void> {
  const plan = appState.mealPlanJson as PlanJsonRoot | null;
  if (!plan) {
    alert("Meal plan details are not available yet. Generate a plan first.");
    return;
  }
  const notesEl = document.getElementById("mealPlanNotes") as HTMLTextAreaElement | null;
  const notes = (notesEl?.value ?? "").trim();

  // Find the current meal to avoid trivial repeats.
  let currentMealSummary = "";
  outer: for (const day of plan.days ?? []) {
    for (const meal of day.meals ?? []) {
      if (meal?.dishId === dishId) {
        currentMealSummary = JSON.stringify(
          {
            dishId: meal.dishId,
            type: meal.type,
            name: meal.name,
            ingredients: meal.ingredients,
          },
          null,
          2
        );
        break outer;
      }
    }
  }

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
    "- The new dish must be meaningfully different from the current one shown below (different main protein or base, and not just small wording changes).\n" +
    "- Do NOT reuse the existing dish name or a trivially similar variation.\n" +
    "- The new dish should fit the same meal type (breakfast, lunch, or dinner) and feel consistent with the rest of the plan.\n" +
    "- Update the grocery.ingredients array so it reflects the full set of ingredients after this change, with each consolidated ingredient listed exactly once.\n" +
    "- Do not change any other structure, and do not include recipes text or headings—only the updated PLAN_JSON object.\n\n" +
    "Current meal to replace (for reference; make the new dish clearly different from this):\n" +
    (currentMealSummary || "(current meal not found by dishId; still replace by dishId)") +
    "\n\n" +
    "Now respond with ONLY the updated PLAN_JSON as a single compact JSON object (no surrounding prose).";

  try {
    setMealRegenerateLoading(true);
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

    // Helper to extract the first complete JSON object from a string, tolerating
    // provider wrappers and trailing metadata.
    const extractFirstJsonObject = (src: string): string | null => {
      const text = src.trim();
      const start = text.indexOf("{");
      if (start === -1) return null;
      let depth = 0;
      let inString = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' && text[i - 1] !== "\\") {
          inString = !inString;
        }
        if (inString) continue;
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            return text.slice(start, i + 1);
          }
        }
      }
      return null;
    };

    let updatedPlan: PlanJsonRoot;
    try {
      // Some providers return a JSON envelope with message.content.
      let candidate = raw;
      try {
        const maybeObj = JSON.parse(raw) as { message?: { content?: string } };
        if (maybeObj && typeof maybeObj === "object" && typeof maybeObj.message?.content === "string") {
          candidate = maybeObj.message.content;
        }
      } catch {
        /* raw might already just be the JSON text */
      }
      const jsonFragment = extractFirstJsonObject(candidate);
      if (!jsonFragment) {
        throw new Error("No JSON object found in model response.");
      }
      updatedPlan = JSON.parse(jsonFragment) as PlanJsonRoot;
    } catch (e) {
      console.error("Failed to parse updated PLAN_JSON", e, raw);
      alert("The model returned an invalid PLAN_JSON. Try again in a moment.");
      return;
    }

    appState.mealPlanJson = updatedPlan;

    const baseText =
      appState.generatedDisplayText || appState.lastGeneratedText || appState.lastGeneratedText;
    const newText = baseText + "\n\nPLAN_JSON:\n" + JSON.stringify(updatedPlan);
    renderGeneratedResult(newText);
    alert("Meal updated. Review the new ingredients and cart lines.");
  } catch (err) {
    console.error(err);
    const msg =
      err instanceof Error && err.message
        ? err.message
        : "Meal regeneration failed due to an unknown error.";
    alert(msg);
  } finally {
    setMealRegenerateLoading(false);
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

function extractPlanJsonFromText(text: string): PlanJsonRoot | undefined {
  const planMarker = "PLAN_JSON:";
  const planIdx = text.lastIndexOf(planMarker);
  if (planIdx === -1) return undefined;
  const planRaw = text.slice(planIdx + planMarker.length);
  try {
    if (planIdx !== -1) {
      const afterPlan = text.slice(planIdx + planMarker.length);
      const planMatch = afterPlan.match(/^[ \t]*\r?\n?([\s\S]+)$/);
      let planRaw = planMatch ? planMatch[1].trim() : afterPlan.trim();
      // Strip markdown code fences like ```json ... ``` if present
      if (planRaw.startsWith("```")) {
        planRaw = planRaw.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```$/, "").trim();
      }
      try {
        const parsed = JSON.parse(planRaw) as any;
        // Normalize shape: some models wrap grocery as a separate "day" object
        let parsedPlan: PlanJsonRoot = parsed;
        if (!parsedPlan.grocery && Array.isArray(parsed.days)) {
          const last = parsed.days[parsed.days.length - 1] as any;
          if (last && last.grocery) {
            parsedPlan = {
              days: parsed.days.slice(0, parsed.days.length - 1),
              grocery: last.grocery,
            };
          }
        }
        return parsedPlan;
      } catch {
        // ignore PLAN_JSON parse errors; keep going
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}