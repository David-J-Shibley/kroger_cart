import { addProductToCart } from "./cart-api.js";
import { shortProductName } from "./html-utils.js";
import { getAccessToken, getKrogerUserTokenOrRefresh } from "./kroger-tokens.js";
import { searchKrogerProducts } from "./kroger-products.js";
import { showProductPicker } from "./product-picker.js";

export async function addItem(): Promise<void> {
  const productEl = document.getElementById("product");
  const qtyEl = document.getElementById("quantity");
  const productName = (productEl as HTMLInputElement | null)?.value?.trim() ?? "";
  const quantity = parseInt((qtyEl as HTMLInputElement | null)?.value ?? "", 10);

  if (!productName || isNaN(quantity) || quantity <= 0) {
    alert("Please enter valid product name and quantity");
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
    const searchTerm = shortProductName(productName);
    const products = await searchKrogerProducts(appToken, searchTerm, 10);
    if (products.length === 0) {
      alert('No products found for "' + searchTerm + '".');
      return;
    }
    if (products.length === 1) {
      await addProductToCart(products[0], quantity);
      return;
    }
    showProductPicker(products, quantity, searchTerm);
  } catch (error) {
    console.error(error);
    alert("Error adding item to cart: " + (error instanceof Error ? error.message : error));
  }
}
