import { SAVED_KROGER_LOCATION_ID_KEY } from "./config.js";

/**
 * From a Kroger store page URL (path …/014/00513), returns the last path segment (store id).
 * Also accepts a bare numeric id. Only trusts hostnames under kroger.com.
 */
export function extractKrogerStoreIdFromUserInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;

  let href = s;
  if (!/^https?:\/\//i.test(href)) {
    if (/kroger\.com/i.test(href)) {
      href = href.replace(/^\/+/, "");
      if (!/^https?:\/\//i.test(href)) href = "https://" + href;
    }
  }

  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    if (host !== "kroger.com" && !host.endsWith(".kroger.com")) return null; /* www.kroger.com, kroger.com */
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) return last;
  } catch {
    return null;
  }
  return null;
}

export function readSavedKrogerLocationOverride(): string {
  try {
    const v = localStorage.getItem(SAVED_KROGER_LOCATION_ID_KEY);
    return v != null && v.trim() !== "" ? v.trim() : "";
  } catch {
    return "";
  }
}

export function writeSavedKrogerLocationOverride(id: string): void {
  try {
    const t = id.trim();
    if (t) localStorage.setItem(SAVED_KROGER_LOCATION_ID_KEY, t);
    else localStorage.removeItem(SAVED_KROGER_LOCATION_ID_KEY);
  } catch {
    /* quota / private mode */
  }
}

export function clearSavedKrogerLocationOverride(): void {
  try {
    localStorage.removeItem(SAVED_KROGER_LOCATION_ID_KEY);
  } catch {
    /* ignore */
  }
}
