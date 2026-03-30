import { appState } from "./app-state.js";
import { mergeAppAuth } from "./authed-fetch.js";
import { SAVED_LLM_KEY } from "./config.js";
import {
  apiUrl,
  ensurePublicConfig,
  getAppOrigin,
  getLlmModel,
  getLlmProxyPrefix,
  tryGetPublicConfig,
} from "./public-config.js";
import { escapeHtml, parseGroceryLines } from "./html-utils.js";
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
  let modelHint = "Qwen/Qwen2.5-7B-Instruct";
  const slowHintId = setTimeout(() => {
    if (pre && pre.textContent === "Connecting...") {
      pre.textContent =
        "Connecting…\n\nStill waiting? The API host (deploy-config apiOrigin) needs FEATHERLESS_API_KEY and must route " +
        (tryGetPublicConfig()?.llmProxyPrefix ?? "/llm-api") +
        " to Express. Check LLM_MODEL on the server and your Featherless plan. Docs: https://featherless.ai/docs/overview";
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
    const llmModel = getLlmModel();
    const llmPrefix = getLlmProxyPrefix();
    modelHint = llmModel;
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
          model: llmModel,
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
    const model = getLlmModel();
    const raw = err instanceof Error ? err.message : String(err);
    let msg: string;
    if (err instanceof Error && err.name === "AbortError") {
      msg =
        "Request timed out after 10 minutes. Try lowering LLM_MODEL size or simplifying the meal-plan prompt.";
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
          "\n\nFeatherless.ai: confirm FEATHERLESS_API_KEY on the API server, LLM_MODEL matches a model you can run, outbound HTTPS to api.featherless.ai is allowed, and your CDN forwards " +
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
