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
import type { MealPlanPrefs } from "./meal-plan.js";
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

const MEAL_TYPE_ORDER: Record<string, number> = {
  breakfast: 0,
  brunch: 1,
  lunch: 2,
  dinner: 3,
  snack: 4,
};

function clampPlanDays(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(14, Math.max(1, Math.round(n)));
}

function expectedMealSlots(prefs: MealPlanPrefs): number {
  const days = clampPlanDays(prefs.days);
  let per = 0;
  if (prefs.includeBreakfast) per++;
  if (prefs.includeLunch) per++;
  if (prefs.includeDinner) per++;
  if (per === 0) per = 1;
  return days * per;
}

function countStructuredMeals(plan: PlanJsonRoot): number {
  let n = 0;
  for (const day of plan.days ?? []) {
    for (const meal of day.meals ?? []) {
      if (meal?.dishId && meal?.name) n++;
    }
  }
  return n;
}

function mealTypeMatchesPrefs(type: string, prefs: MealPlanPrefs): boolean {
  const t = type.toLowerCase();
  if (t === "breakfast" || t === "brunch") return prefs.includeBreakfast;
  if (t === "lunch") return prefs.includeLunch;
  if (t === "dinner") return prefs.includeDinner;
  return false;
}

/** Recover meal rows from prose when PLAN_JSON only echoed the prompt's single-meal example. */
function extractMealsFromOverviewText(text: string, prefs: MealPlanPrefs): PlanJsonMeal[] {
  const seen = new Set<string>();
  const meals: PlanJsonMeal[] = [];
  const lines = text.split(/\r?\n/);
  let currentDay = 1;
  const maxDay = clampPlanDays(prefs.days);

  const recipeLineRe =
    /^\s*(?:#{1,6}\s*)?Day\s+(\d+)\s*[—\-–]\s*(breakfast|lunch|dinner|brunch|snack)\s*:\s*(.+)$/i;
  const dayHeadingRe =
    /^\s*(?:#{1,6}\s*)?Day\s+(\d+)\b(?!\s*[—\-–]\s*(?:breakfast|lunch|dinner|brunch|snack)\s*:)/i;
  const bulletMealRe = /^\s*[-*]\s*(breakfast|lunch|dinner|brunch|snack)\s*:\s*(.+)$/i;

  for (const line of lines) {
    const rm = line.match(recipeLineRe);
    if (rm) {
      const day = parseInt(rm[1], 10);
      const type = rm[2].toLowerCase();
      const name = rm[3].trim();
      if (
        name &&
        Number.isFinite(day) &&
        day >= 1 &&
        day <= maxDay &&
        mealTypeMatchesPrefs(type, prefs)
      ) {
        const dishId = `day${day}-${type}-1`;
        if (!seen.has(dishId)) {
          seen.add(dishId);
          meals.push({ dishId, type, name, notes: "", ingredients: [], steps: [] });
        }
      }
      continue;
    }

    const dm = line.match(dayHeadingRe);
    if (dm) {
      const d = parseInt(dm[1], 10);
      if (Number.isFinite(d) && d >= 1 && d <= maxDay) currentDay = d;
      continue;
    }

    const bm = line.match(bulletMealRe);
    if (bm) {
      const type = bm[1].toLowerCase();
      const name = bm[2].trim();
      if (name && mealTypeMatchesPrefs(type, prefs)) {
        const dishId = `day${currentDay}-${type}-1`;
        if (!seen.has(dishId)) {
          seen.add(dishId);
          meals.push({ dishId, type, name, notes: "", ingredients: [], steps: [] });
        }
      }
    }
  }
  return meals;
}

function groupMealsIntoDays(meals: PlanJsonMeal[], maxDay: number): PlanJsonDay[] {
  const byDay = new Map<number, PlanJsonMeal[]>();
  for (const m of meals) {
    const id = String(m.dishId || "");
    const dm = id.match(/^day(\d+)-/i);
    const day = dm ? parseInt(dm[1], 10) : 1;
    if (day < 1 || day > maxDay) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(m);
  }
  const days: PlanJsonDay[] = [];
  for (let d = 1; d <= maxDay; d++) {
    const ms = byDay.get(d);
    if (!ms?.length) continue;
    ms.sort(
      (a, b) =>
        (MEAL_TYPE_ORDER[(a.type || "").toLowerCase()] ?? 9) -
        (MEAL_TYPE_ORDER[(b.type || "").toLowerCase()] ?? 9)
    );
    days.push({ day: d, label: `Day ${d}`, meals: ms });
  }
  return days;
}

function hydratePlanMealsIfIncomplete(
  parsedPlan: PlanJsonRoot,
  overviewText: string,
  prefs: MealPlanPrefs
): PlanJsonRoot {
  const expected = expectedMealSlots(prefs);
  const actual = countStructuredMeals(parsedPlan);
  if (actual >= expected) return parsedPlan;

  const extracted = extractMealsFromOverviewText(overviewText, prefs);
  if (extracted.length <= actual) return parsedPlan;

  const maxDay = clampPlanDays(prefs.days);
  const days = groupMealsIntoDays(extracted, maxDay);
  if (!days.length) return parsedPlan;

  return { ...parsedPlan, days };
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

      const prefs = readMealPlanPrefsFromForm();
      appState.mealPlanJson = hydratePlanMealsIfIncomplete(parsedPlan, before, prefs);

      // Use grocery.ingredients in PLAN_JSON as the primary source of ingredient lines.
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
        // Heuristic: trust PLAN_JSON only when it returns a reasonable number
        // of ingredients. If the model only emitted one or two items here,
        // fall back to parsing the human-readable grocery list instead.
        if (labels.length >= 3) {
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
  const plan = appState.mealPlanJson as PlanJsonRoot | null;
  renderMealRegenerateControls(plan ?? undefined);
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
  out.innerHTML = '<pre class="generated-text">Creating meal-plan job…</pre>';
  const pre = out.querySelector("pre");
  (btn as HTMLButtonElement).disabled = false; // keep button usable

  try {
    await ensurePublicConfig();
    const pub = tryGetPublicConfig();
    if (pub?.authRequired) {
      const me = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
      if (!me.ok) {
        out.style.display = "none";
        alert("Sign in or create an account (buttons in the header) to generate a meal plan.");
        return;
      }
    }

    const prefs = readMealPlanPrefsFromForm();
    persistMealPlanPrefs(prefs);

    const res = await fetch(apiUrl("/api/meal-plan-jobs"), mergeAppAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }));
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Job creation failed (HTTP ${res.status}): ${body}`);
    }
    const { jobId } = (await res.json()) as { jobId: string };

    if (pre) {
      pre.textContent =
        "Meal-plan job created.\n\nYou can keep using the app while it runs.\n\nJob id: " +
        jobId +
        "\n\nWaiting for result…";
    }

    await pollMealPlanJob(jobId);
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (out) out.textContent = "Error: " + msg;
  }
}

async function pollMealPlanJob(jobId: string): Promise<void> {
  const out = document.getElementById("generated");
  const pre = out?.querySelector("pre");
  let attempts = 0;

  while (true) {
    attempts++;
    try {
      const res = await fetch(apiUrl(`/api/meal-plan-jobs/${jobId}`), mergeAppAuth({
        method: "GET",
      }));
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Job status failed (HTTP ${res.status}): ${body}`);
      }
      const job = (await res.json()) as {
        status: "pending" | "running" | "succeeded" | "failed";
        resultText?: string;
        error?: string;
      };

      if (job.status === "succeeded" && job.resultText) {
        renderGeneratedResult(job.resultText);
        return;
      }
      if (job.status === "failed") {
        const errMsg = job.error || "Meal plan job failed.";
        if (out) out.textContent = "Error: " + errMsg;
        return;
      }

      if (pre) {
        pre.textContent =
          "Meal-plan job " +
          job.status +
          "…\n\nYou can keep using the app while it finishes.\n\nJob id: " +
          jobId;
      }
    } catch (err) {
      console.error(err);
      if (out) {
        out.textContent =
          "Error while checking job status. You can refresh the page and try again.\n" +
          (err instanceof Error ? err.message : String(err));
      }
      return;
    }

    // simple backoff: 1.5s, up to ~30 attempts (~45s)
    const delay = Math.min(1500 + attempts * 200, 5000);
    await new Promise((r) => setTimeout(r, delay));
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
