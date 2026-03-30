import { SAVED_LLM_MODEL_KEY } from "./config.js";
import { tryGetPublicConfig } from "./public-config.js";

function mealPlanOptionsEl(): HTMLElement | null {
  return document.getElementById("mealPlanOptions");
}

/**
 * Ensure the model row exists. Production sites often update `deploy-config.json` and `kroger-cart.js`
 * before `index.html`; without this, missing `#llmModelRow` caused a silent no-op.
 */
function ensureLlmModelRowDom(): { row: HTMLElement; sel: HTMLSelectElement } | null {
  const container = mealPlanOptionsEl();
  if (!container) return null;

  let row = document.getElementById("llmModelRow");
  let sel = document.getElementById("llmModelSelect") as HTMLSelectElement | null;

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
  hint.textContent =
    "Choose another model if you see a capacity error. Options come from deploy-config (llmModels); ids must match your Featherless plan.";

  row.appendChild(label);
  row.appendChild(sel);
  row.appendChild(hint);
  container.appendChild(row);

  return { row, sel };
}

/**
 * Populates the meal-plan model dropdown when `deploy-config.json` includes two or more `llmModels`.
 * Call after `loadDeployConfig()` / `ensurePublicConfig()`.
 */
export function initLlmModelSelector(): void {
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
    /* ignore */
  }
  if (!options.includes(initial)) initial = options[0];
  sel.value = initial;

  sel.addEventListener("change", () => {
    try {
      localStorage.setItem(SAVED_LLM_MODEL_KEY, sel.value);
    } catch {
      /* ignore */
    }
  });
}
