import {
  clearSavedKrogerLocationOverride,
  extractKrogerStoreIdFromUserInput,
  readSavedKrogerLocationOverride,
  writeSavedKrogerLocationOverride,
} from "./kroger-store-url.js";
import { getKrogerLocationId, tryGetPublicConfig } from "./public-config.js";

function deployDefaultLocationId(): string {
  return (tryGetPublicConfig()?.krogerLocationId ?? "").trim();
}

function syncKrogerLocationStatus(): void {
  const status = document.getElementById("krogerLocationStatus");
  const clearBtn = document.getElementById("krogerStoreClearBtn");
  if (!status) return;

  const override = readSavedKrogerLocationOverride();
  const effective = getKrogerLocationId();
  const fallback = deployDefaultLocationId();

  if (effective) {
    if (override) {
      status.textContent =
        "Using store " + effective + " (from your link). Product search and prices use this location.";
    } else if (fallback) {
      status.textContent =
        "Using store " + effective + " from site configuration. Paste a store URL below to override.";
    } else {
      status.textContent = "Using store " + effective + ".";
    }
  } else {
    status.textContent =
      "No store selected — search may omit local pricing. Paste a Kroger store page URL (or a numeric store id) and click Apply.";
  }

  if (clearBtn) {
    clearBtn.hidden = !override;
  }
}

function applyKrogerStoreFromInput(): void {
  const input = document.getElementById("krogerStoreUrlInput") as HTMLInputElement | null;
  if (!input) return;
  const parsed = extractKrogerStoreIdFromUserInput(input.value);
  if (!parsed) {
    alert(
      "Could not find a store id. Paste the full store page URL (we combine …/014/00513 into Kroger’s 8-character location id) or enter digits only."
    );
    return;
  }
  writeSavedKrogerLocationOverride(parsed);
  input.value = "";
  syncKrogerLocationStatus();
}

export function initKrogerLocationUi(): void {
  const applyBtn = document.getElementById("krogerStoreApplyBtn");
  const clearBtn = document.getElementById("krogerStoreClearBtn");
  const input = document.getElementById("krogerStoreUrlInput") as HTMLInputElement | null;

  syncKrogerLocationStatus();

  applyBtn?.addEventListener("click", () => applyKrogerStoreFromInput());
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyKrogerStoreFromInput();
    }
  });
  clearBtn?.addEventListener("click", () => {
    clearSavedKrogerLocationOverride();
    syncKrogerLocationStatus();
  });
}
