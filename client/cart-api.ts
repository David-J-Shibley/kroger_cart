import { showAddToCartToast } from "./cart-feedback.js";
import { krogerProxyHeaders } from "./authed-fetch.js";
import { getKrogerUserTokenOrRefresh } from "./kroger-tokens.js";
import { ensurePublicConfig, getBackendOrigin } from "./public-config.js";
import { shortProductName } from "./html-utils.js";
import type { KrogerCartResponse, KrogerProduct } from "./types.js";

export type AddToCartOptions = {
  /** Shown under the main toast line (e.g. auto-pick rule). */
  toastDetail?: string;
};

export async function addProductToCart(
  product: KrogerProduct,
  quantity: number,
  options?: AddToCartOptions
): Promise<boolean> {
  const userToken = await getKrogerUserTokenOrRefresh();
  if (!userToken) {
    alert("Please sign in with Kroger first.");
    return false;
  }
  await ensurePublicConfig();
  const fileProto = window.location.protocol === "file:";
  const krogerBase = fileProto ? "https://api.kroger.com" : "";
  const krogerPrefix = fileProto ? "" : getBackendOrigin() + "/kroger-api";
  const cartUrl = krogerBase + krogerPrefix + "/v1/cart/add";
  const itemData = {
    items: [
      {
        quantity,
        upc: product.upc || undefined,
        productId: product.productId || undefined,
        product: { name: shortProductName(product.name), price: product.price },
      },
    ],
  };
  try {
    const response = await fetch(cartUrl, {
      method: "PUT",
      headers: {
        ...krogerProxyHeaders(userToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(itemData),
    });
    const text = await response.text();
    let result: KrogerCartResponse = {};
    try {
      result = text ? (JSON.parse(text) as KrogerCartResponse) : {};
    } catch {
      result = {};
    }
    if (response.status === 403) {
      const err = result as unknown as { error?: string; code?: string };
      if (err.error === "subscription_required") {
        alert("An active subscription is required. Use Subscribe in the header.");
        return false;
      }
      if (err.code === "AUTH-1007") {
        alert("Cart request was denied. Try signing out and signing in again.");
        return false;
      }
      alert("Cart request was denied. Try signing out and signing in again.");
      return false;
    }
    if (result.code === "AUTH-1007") {
      alert("Cart request was denied. Try signing out and signing in again.");
      return false;
    }
    if (!response.ok) {
      alert(
        "Error adding to cart: " + (result.message || result.code || response.status)
      );
      return false;
    }
    displayCart(result);
    showAddToCartToast(shortProductName(product.name), quantity, options?.toastDetail);
    return true;
  } catch (e) {
    console.error(e);
    alert("Error adding to cart: " + (e instanceof Error ? e.message : e));
    return false;
  }
}

export function displayCart(items: KrogerCartResponse): void {
  const cartDiv = document.getElementById("cart");
  if (!cartDiv) return;
  cartDiv.innerHTML = "";
  if (items?.items && items.items.length > 0) {
    for (const item of items.items) {
      const itemDiv = document.createElement("div");
      itemDiv.textContent =
        `${item.product.name} x${item.quantity} - $${(item.product.price * item.quantity).toFixed(2)}`;
      cartDiv.appendChild(itemDiv);
    }
  } else {
    cartDiv.textContent = "Your cart is empty";
  }
}
