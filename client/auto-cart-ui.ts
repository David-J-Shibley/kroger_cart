import { getAutoAddEnabled, getAutoAddStrategy, setAutoAddEnabled, setAutoAddStrategy } from "./auto-cart-prefs.js";
import type { AutoCartStrategy } from "./auto-cart-strategy.js";

const CHECKBOX_ID = "autoAddToCartEnabled";
const SELECT_ID = "autoAddToCartStrategy";

function syncSelectDisabled(): void {
  const cb = document.getElementById(CHECKBOX_ID) as HTMLInputElement | null;
  const sel = document.getElementById(SELECT_ID) as HTMLSelectElement | null;
  if (!cb || !sel) return;
  sel.disabled = !cb.checked;
}

const ADD_ALL_TOOLBAR_ID = "addAllCartToolbar";
const ADD_SELECTED_BTN_ID = "addSelectedToCartBtn";

/** Show bulk cart toolbar when auto-pick is on, cart section is visible, and there are grocery lines. */
export function syncAddAllToCartToolbar(): void {
  const toolbar = document.getElementById(ADD_ALL_TOOLBAR_ID);
  const section = document.getElementById("add-to-cart-section");
  if (!toolbar || !section) return;
  const lineCount =
    document.getElementById("generated-list")?.querySelectorAll(".grocery-line").length ?? 0;
  const sectionVisible = section.style.display !== "none";
  const show = getAutoAddEnabled() && sectionVisible && lineCount > 0;
  toolbar.hidden = !show;
  const addSelected = document.getElementById(ADD_SELECTED_BTN_ID) as HTMLButtonElement | null;
  if (addSelected) {
    const checked =
      document.querySelectorAll("#generated-list .grocery-line-check:checked").length;
    addSelected.disabled = checked === 0;
  }
}

export function initAutoCartPreferencesUi(): void {
  const cb = document.getElementById(CHECKBOX_ID) as HTMLInputElement | null;
  const sel = document.getElementById(SELECT_ID) as HTMLSelectElement | null;
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
    setAutoAddStrategy(sel.value as AutoCartStrategy);
  });

  const listEl = document.getElementById("generated-list");
  listEl?.addEventListener("change", (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.classList.contains("grocery-line-check")) {
      syncAddAllToCartToolbar();
    }
  });
}
