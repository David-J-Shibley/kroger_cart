import { appState } from "./app-state.js";
import { mergeAppAuth } from "./authed-fetch.js";
import { getCognitoAccessToken } from "./auth-session.js";
import { OLLAMA_API_PATH, SAVED_LLM_KEY } from "./config.js";
import {
  ensurePublicConfig,
  getAppOrigin,
  getLlmProvider,
  getOllamaModel,
  tryGetPublicConfig,
} from "./public-config.js";
import { escapeHtml, parseGroceryLines } from "./html-utils.js";
import {
  buildMealPlanPrompt,
  mealPlanNumPredict,
  persistMealPlanPrefs,
  readMealPlanPrefsFromForm,
} from "./meal-plan.js";
import type { OllamaMessage } from "./types.js";
import { EXAMPLE_MEAL_PLAN_TEXT } from "./example-meal-plan.js";
import { showBulkAddKrogerFollowup } from "./kroger-app-launch.js";
import { searchAndAddToCart } from "./add-to-cart.js";
import { getAutoAddEnabled } from "./auto-cart-prefs.js";
import { syncAddAllToCartToolbar } from "./auto-cart-ui.js";

const BULK_ADD_DELAY_MS = 400;

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
  out.innerHTML =
    '<pre class="generated-text">' +
    escapeHtml(text) +
    '</pre><p class="generated-actions">' +
    '<button type="button" onclick="saveLLMToStorage()">Save to storage</button>' +
    '<button type="button" class="btn-secondary" onclick="copyGroceryListToClipboard()">Copy grocery list</button>' +
    "</p>";
  const items = parseGroceryLines(text);
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
  let modelHint = "qwen3:8b";
  const slowHintId = setTimeout(() => {
    if (pre && pre.textContent === "Connecting...") {
      if (getLlmProvider() === "featherless") {
        pre.textContent =
          "Connecting…\n\nStill waiting? The server uses Featherless.ai — check FEATHERLESS_API_KEY, LLM_MODEL, and your plan limits. Docs: https://featherless.ai/docs/overview";
      } else {
        pre.textContent =
          "Connecting…\n\nTaking a while? If you're using Docker, pull the model first:\n  docker exec -it kroger-ollama ollama pull " +
          modelHint;
      }
    }
  }, 15000);
  try {
    await ensurePublicConfig();
    const pub = tryGetPublicConfig();
    if (pub?.authRequired && !getCognitoAccessToken()) {
      clearTimeout(slowHintId);
      out.style.display = "none";
      (btn as HTMLButtonElement).disabled = false;
      alert("Sign in or create an account (buttons in the header) to generate a meal plan.");
      return;
    }
    const ollamaModel = getOllamaModel();
    modelHint = ollamaModel;
    const prefs = readMealPlanPrefsFromForm();
    persistMealPlanPrefs(prefs);
    const prompt = buildMealPlanPrompt(prefs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600_000);
    const response = await fetch(
      getAppOrigin() + OLLAMA_API_PATH + "/api/chat",
      mergeAppAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          options: { num_predict: mealPlanNumPredict(prefs) },
        }),
        signal: controller.signal,
      })
    );
    clearTimeout(timeoutId);
    clearTimeout(slowHintId);
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
    const model = getOllamaModel();
    const raw = err instanceof Error ? err.message : String(err);
    let msg: string;
    if (err instanceof Error && err.name === "AbortError") {
      msg =
        getLlmProvider() === "featherless"
          ? "Request timed out after 10 minutes. Try lowering LLM_MODEL size or simplifying the meal-plan prompt."
          : "Request timed out after 10 minutes. Try a smaller model or shorter prompt. In Docker, ensure the model is pulled: docker exec -it kroger-ollama ollama pull " +
            model;
    } else {
      msg = "Error: " + raw;
      const looksLikeOllamaOrNetwork =
        /ECONNREFUSED|ENOTFOUND|fetch failed|Cannot reach Ollama|502|model|pull/i.test(raw) ||
        (/HTTP 5/.test(raw) && !/DYNAMODB|subscription/i.test(raw));
      const isAuthOrBillingGate =
        /DYNAMODB_USERS_TABLE|subscription is required|SUBSCRIPTION_REQUIRED|Unauthorized|Missing Cognito|Invalid or expired token/i.test(
          raw
        );
      if (looksLikeOllamaOrNetwork && !isAuthOrBillingGate) {
        if (getLlmProvider() === "featherless") {
          msg +=
            "\n\nFeatherless.ai: confirm FEATHERLESS_API_KEY on the API server, LLM_MODEL matches a model you can run, and outbound HTTPS to api.featherless.ai is allowed. See https://featherless.ai/docs/overview";
        } else {
          msg +=
            "\n\nMake sure Ollama is running and the model '" +
            model +
            "' is pulled. In Docker: docker exec -it kroger-ollama ollama pull " +
            model;
        }
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
