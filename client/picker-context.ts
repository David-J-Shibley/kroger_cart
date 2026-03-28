import type { PickerProduct } from "./types.js";

let products: PickerProduct[] = [];
let productsOriginal: PickerProduct[] = [];
let quantity = 1;

export function setPickerSession(prods: PickerProduct[], qty: number): void {
  productsOriginal = [...prods];
  products = [...prods];
  quantity = qty;
}

export function getPickerProducts(): PickerProduct[] {
  return products;
}

export function getPickerProductsOriginal(): PickerProduct[] {
  return productsOriginal;
}

export function setPickerProductsOrdered(next: PickerProduct[]): void {
  products = next;
}

export function getPickerQuantity(): number {
  return quantity;
}
