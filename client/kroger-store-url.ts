import { SAVED_KROGER_LOCATION_ID_KEY } from "./config.js";

/**
 * Kroger APIs (cart add, product filters) require `locationId` as exactly 8 alphanumeric characters.
 * Purely numeric values shorter than 8 are left-padded with zeros. Longer numeric strings are rejected.
 */
export function normalizeKrogerLocationIdForApi(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, "");
  if (!s) return null;
  if (/^[a-zA-Z0-9]{8}$/i.test(s)) return s.toUpperCase();
  if (/^\d+$/.test(s)) {
    if (s.length > 8) return null;
    return s.length === 8 ? s : s.padStart(8, "0");
  }
  return null;
}

/**
 * From a Kroger store page URL (path …/014/00513), returns an 8-character location id (e.g. 01400513).
 * Uses the last two numeric path segments when both exist; otherwise the last numeric segment.
 * Also accepts a bare numeric id. Only trusts hostnames under kroger.com.
 */
export function extractKrogerStoreIdFromUserInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return normalizeKrogerLocationIdForApi(s);

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

    if (parts.length >= 2) {
      const a = parts[parts.length - 2];
      const b = parts[parts.length - 1];
      if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
        const combined = a + b;
        const n = normalizeKrogerLocationIdForApi(combined);
        if (n) return n;
      }
    }

    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) return normalizeKrogerLocationIdForApi(last);
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
