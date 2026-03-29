import { autoStrategyLabel, pickProductByStrategy } from "./auto-cart-strategy.js";
import { getAutoAddEnabled, getAutoAddStrategy } from "./auto-cart-prefs.js";
import { showAutoPickFeedback } from "./auto-cart-ui.js";
import { addProductToCart } from "./cart-api.js";
import { shortProductName } from "./html-utils.js";
import { getAccessToken, getKrogerUserTokenOrRefresh } from "./kroger-tokens.js";
import { searchKrogerProducts } from "./kroger-products.js";
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
export async function searchAndAddToCart(productName: string, quantity: number): Promise<void> {
  const name = productName.trim();
  if (!name || isNaN(quantity) || quantity <= 0) {
    alert("Please enter a valid product name and quantity.");
    return;
  }

  const userToken = await getKrogerUserTokenOrRefresh();
  if (!userToken) {
    alert(
      'Please sign in with Kroger first (click "Sign in with Kroger" above) to add items to your cart.'
    );
    return;
  }

  try {
    const appToken = await getAccessToken();
    const searchTerm = shortProductName(name);
    const auto = getAutoAddEnabled();
    const limit = auto ? SEARCH_LIMIT_AUTO : SEARCH_LIMIT_MANUAL;
    const products = await searchKrogerProducts(appToken, searchTerm, limit);
    if (products.length === 0) {
      alert('No products found for "' + searchTerm + '".');
      return;
    }
    if (products.length === 1) {
      await addProductToCart(products[0], quantity);
      return;
    }
    if (auto) {
      const strategy = getAutoAddStrategy();
      const chosen = pickProductByStrategy(products, strategy);
      const priceNote = chosen.price > 0 ? " ($" + chosen.price.toFixed(2) + ")" : "";
      const ok = await addProductToCart(chosen, quantity);
      if (ok) {
        showAutoPickFeedback(
          "Added: " +
            chosen.name +
            priceNote +
            " — " +
            autoStrategyLabel(strategy) +
            "."
        );
      }
      return;
    }
    showProductPicker(products, quantity, searchTerm);
  } catch (error) {
    console.error(error);
    alert("Error adding item to cart: " + (error instanceof Error ? error.message : error));
  }
}
