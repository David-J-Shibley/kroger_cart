import { appState } from "./app-state.js";
import { mergeAppAuth } from "./authed-fetch.js";
import { getCognitoAccessToken } from "./auth-session.js";
import { OLLAMA_API_PATH, SAVED_LLM_KEY } from "./config.js";
import { ensurePublicConfig, getAppOrigin, getOllamaModel, tryGetPublicConfig } from "./public-config.js";
import { escapeHtml, parseGroceryLines } from "./html-utils.js";
import {
  buildMealPlanPrompt,
  persistMealPlanPrefs,
  readMealPlanPrefsFromForm,
} from "./meal-plan.js";
import type { OllamaMessage } from "./types.js";
import { addItem } from "./add-to-cart.js";

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
    void addItem();
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
      pre.textContent =
        "Connecting...\n\nTaking a while? If you're using Docker, pull the model first:\n  docker exec -it kroger-ollama ollama pull " +
        modelHint;
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
          options: { num_predict: 2048 },
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
        "Request timed out after 10 minutes. Try a smaller model or shorter prompt. In Docker, ensure the model is pulled: docker exec -it kroger-ollama ollama pull " +
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
        msg +=
          "\n\nMake sure Ollama is running and the model '" +
          model +
          "' is pulled. In Docker: docker exec -it kroger-ollama ollama pull " +
          model;
      } else if (/DYNAMODB_USERS_TABLE|Subscription checks require/i.test(raw)) {
        msg +=
          "\n\nEither set DYNAMODB_USERS_TABLE in .env (and create the table), or set SUBSCRIPTION_REQUIRED=false if you are not using Stripe subscriptions yet.";
      } else if (/subscription is required|SUBSCRIPTION_REQUIRED/i.test(raw)) {
        msg += "\n\nSubscribe via the app header, or set SUBSCRIPTION_REQUIRED=false for local dev.";
      }
    }
    out.textContent = msg;
  } finally {
    (btn as HTMLButtonElement).disabled = false;
  }
}
