import { autoStrategyLabel, pickProductByStrategy } from "./auto-cart-strategy.js";
import { getAutoAddEnabled, getAutoAddStrategy } from "./auto-cart-prefs.js";
import { addProductToCart } from "./cart-api.js";
import { shortProductName } from "./html-utils.js";
import {
  getAccessToken,
  getKrogerAccountLinked,
  getKrogerUserTokenOrRefresh,
  refreshKrogerLinkedFromApi,
} from "./kroger-tokens.js";
import { searchKrogerProducts } from "./kroger-products.js";
import { ensurePublicConfig, tryGetPublicConfig } from "./public-config.js";
import { showProductPicker } from "./product-picker.js";

const SEARCH_LIMIT_MANUAL = 10;
const SEARCH_LIMIT_AUTO = 30;

export async function addItem(): Promise<void> {
  const productEl = document.getElementById("product");
  const qtyEl = document.getElementById("quantity");
  const productName = (productEl as HTMLInputElement | null)?.value?.trim() ?? "";
  const quantity = parseInt((qtyEl as HTMLInputElement | null)?.value ?? "", 10);
  await searchAndAddToCart(productName, quantity);
}

/**
 * Search Kroger for a line label (e.g. from the generated grocery list) and add to cart.
 * Uses auto-pick rules when enabled; otherwise opens the product chooser when multiple matches exist.
 */
/** @returns true if the item was added (or add API reported success); false if blocked, failed, or manual picker opened. */
export async function searchAndAddToCart(productName: string, quantity: number): Promise<boolean> {
  const name = productName.trim();
  if (!name || isNaN(quantity) || quantity <= 0) {
    alert("Please enter a valid product name and quantity.");
    return false;
  }

  await ensurePublicConfig();
  const cookieMode = Boolean(tryGetPublicConfig()?.cookieSessionAuth);
  if (cookieMode) {
    await refreshKrogerLinkedFromApi();
    if (!getKrogerAccountLinked()) {
      alert(
        'Please sign in with Kroger first (click "Sign in with Kroger" above) to add items to your cart.'
      );
      return false;
    }
  } else {
    const userToken = await getKrogerUserTokenOrRefresh();
    if (!userToken) {
      alert(
        'Please sign in with Kroger first (click "Sign in with Kroger" above) to add items to your cart.'
      );
      return false;
    }
  }

  try {
    const appToken = await getAccessToken();
    const searchTerm = shortProductName(name);
    const auto = getAutoAddEnabled();
    const limit = auto ? SEARCH_LIMIT_AUTO : SEARCH_LIMIT_MANUAL;
    const products = await searchKrogerProducts(appToken, searchTerm, limit);
    if (products.length === 0) {
      alert('No products found for "' + searchTerm + '".');
      return false;
    }
    if (products.length === 1) {
      return addProductToCart(products[0], quantity);
    }
    if (auto) {
      const strategy = getAutoAddStrategy();
      const chosen = pickProductByStrategy(products, strategy);
      const priceNote = chosen.price > 0 ? " · $" + chosen.price.toFixed(2) : "";
      return addProductToCart(chosen, quantity, {
        toastDetail: autoStrategyLabel(strategy) + priceNote,
      });
    }
    showProductPicker(products, quantity, searchTerm);
    return false;
  } catch (error) {
    console.error(error);
    alert("Error adding item to cart: " + (error instanceof Error ? error.message : error));
    return false;
  }
}
