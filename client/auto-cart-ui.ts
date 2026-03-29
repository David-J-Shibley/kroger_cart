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
  });
  sel.addEventListener("change", () => {
    setAutoAddStrategy(sel.value as AutoCartStrategy);
  });
}
