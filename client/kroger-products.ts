import { krogerProxyHeaders } from "./authed-fetch.js";
import { clearKrogerToken } from "./kroger-tokens.js";
import {
  ensurePublicConfig,
  getBackendOrigin,
  getKrogerLocationId,
  tryGetPublicConfig,
} from "./public-config.js";
import type { PickerProduct } from "./types.js";

export async function searchKrogerProducts(
  token: string,
  searchTerm: string,
  limit: number = 10
): Promise<PickerProduct[]> {
  await ensurePublicConfig();
  const fileProto = window.location.protocol === "file:";
  const krogerBase = fileProto ? "https://api.kroger.com" : "";
  const krogerPrefix = fileProto ? "" : getBackendOrigin() + "/kroger-api";
  let url =
    krogerBase +
    krogerPrefix +
    "/v1/products?filter.term=" +
    encodeURIComponent(searchTerm) +
    "&filter.limit=" +
    limit;
  const loc = getKrogerLocationId();
  if (loc) url += "&filter.locationId=" + encodeURIComponent(loc);
  const bearerToken = String(token).replace(/\s+/g, "").trim();
  const res = await fetch(url, {
    headers: krogerProxyHeaders(bearerToken),
    ...(tryGetPublicConfig()?.cookieSessionAuth ? { credentials: "include" as RequestCredentials } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 || (json.code && String(json.code) === "AUTH-1007")) {
    clearKrogerToken();
    throw new Error("Kroger returned invalid token. Try signing in again.");
  }
  if (!res.ok) return [];
  const list = (json.data || json.items || []) as Record<string, unknown>[];
  return list.map((p) => {
    const priceObj =
      (p.items as Record<string, unknown>[])?.[0] != null
        ? ((p.items as Record<string, unknown>[])[0] as Record<string, unknown>).price
        : p.price != null
          ? { regular: p.price }
          : null;
    const priceObj2 = priceObj as { regular?: number; promo?: number } | null;
    const price = priceObj2?.regular ?? priceObj2?.promo ?? 0;
    const product: PickerProduct = {
      upc: String(p.upc || p.productId || ""),
      productId: String(p.productId || p.upc || ""),
      name: String(p.description || p.productId || searchTerm),
      price: typeof price === "number" ? price : parseFloat(String(price)) || 0,
      raw: p,
    };
    return product;
  });
}
