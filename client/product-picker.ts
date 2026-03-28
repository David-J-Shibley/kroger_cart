import { addProductToCart } from "./cart-api.js";
import { escapeHtml } from "./html-utils.js";
import {
  getPickerProducts,
  getPickerProductsOriginal,
  getPickerQuantity,
  setPickerProductsOrdered,
  setPickerSession,
} from "./picker-context.js";
import type { PickerProduct } from "./types.js";

type PickerSort = "default" | "price-asc" | "price-desc";

export function closeProductPicker(): void {
  const modal = document.getElementById("productPickerModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

function renderProductPickerList(sortBy: PickerSort): void {
  const listEl = document.getElementById("productPickerList");
  const original = getPickerProductsOriginal();
  if (!listEl || original.length === 0) return;
  let ordered: PickerProduct[];
  if (sortBy === "price-asc") {
    ordered = [...original].sort((a, b) => a.price - b.price);
  } else if (sortBy === "price-desc") {
    ordered = [...original].sort((a, b) => b.price - a.price);
  } else {
    ordered = [...original];
  }
  setPickerProductsOrdered(ordered);
  listEl.innerHTML = ordered
    .map((p, i) => {
      const name = escapeHtml(p.name || "Product " + (i + 1));
      const price = p.price > 0 ? "$" + p.price.toFixed(2) : "Price N/A";
      return (
        '<div class="modal-product">' +
        '<div class="info"><span class="name">' +
        name +
        '</span><br><span class="price">' +
        price +
        '</span></div>' +
        '<div class="modal-product-actions">' +
        '<button type="button" class="btn-meta" data-picker-index="' +
        i +
        '" onclick="showProductMetadata(parseInt(this.getAttribute(\'data-picker-index\'),10))">Metadata</button>' +
        '<button type="button" class="btn-add" data-picker-index="' +
        i +
        '" onclick="pickProductAndAdd(parseInt(this.getAttribute(\'data-picker-index\'),10))">Add to cart</button>' +
        "</div></div>"
      );
    })
    .join("");
}

export function showProductPicker(
  prods: PickerProduct[],
  qty: number,
  searchTerm: string
): void {
  const title = document.getElementById("productPickerTitle");
  const toolbarEl = document.getElementById("productPickerToolbar");
  const listEl = document.getElementById("productPickerList");
  const modal = document.getElementById("productPickerModal");
  if (!title || !toolbarEl || !listEl || !modal) return;
  title.textContent = 'Choose a product for "' + (searchTerm || "") + '"';
  setPickerSession(prods, qty);

  toolbarEl.innerHTML =
    '<label for="productPickerSortSelect">Sort:</label>' +
    '<select id="productPickerSortSelect" aria-label="Sort by price">' +
    '<option value="default">Default order</option>' +
    '<option value="price-asc">Price: low to high</option>' +
    '<option value="price-desc">Price: high to low</option>' +
    "</select>";
  const sortSelect = document.getElementById("productPickerSortSelect") as HTMLSelectElement | null;
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      renderProductPickerList((sortSelect.value as PickerSort) || "default");
    });
  }

  renderProductPickerList("default");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

export function showProductMetadata(index: number): void {
  const products = getPickerProducts();
  const preEl = document.getElementById("productMetadataPre");
  const metaModal = document.getElementById("productMetadataModal");
  if (!products[index] || !preEl || !metaModal) return;
  const product = products[index];
  const toShow = product.raw != null ? product.raw : product;
  preEl.textContent = JSON.stringify(toShow, null, 2);
  metaModal.classList.remove("hidden");
  metaModal.setAttribute("aria-hidden", "false");
}

export function closeProductMetadata(): void {
  const metaModal = document.getElementById("productMetadataModal");
  if (metaModal) {
    metaModal.classList.add("hidden");
    metaModal.setAttribute("aria-hidden", "true");
  }
}

export async function pickProductAndAdd(index: number): Promise<void> {
  const products = getPickerProducts();
  const qty = getPickerQuantity();
  if (!products[index]) return;
  closeProductPicker();
  await addProductToCart(products[index], qty ?? 1);
}
