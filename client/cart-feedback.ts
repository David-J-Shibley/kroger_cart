let toastHideTimer: ReturnType<typeof setTimeout> | undefined;
let toastDismissTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Non-blocking confirmation after Kroger accepts an add-to-cart request.
 */
export function showAddToCartToast(displayName: string, quantity: number, detail?: string): void {
  const root = document.getElementById("cartToast");
  if (!root) return;

  const main = root.querySelector(".cart-toast__main");
  const sub = root.querySelector(".cart-toast__detail") as HTMLElement | null;
  const safeName =
    displayName.length > 72 ? displayName.slice(0, 69).trimEnd() + "…" : displayName;

  const line1 = `Added to your Kroger cart: ${safeName} × ${quantity}`;
  if (main) {
    main.textContent = line1;
  } else {
    root.textContent = line1 + (detail ? "\n" + detail : "");
  }
  if (sub) {
    if (detail) {
      sub.textContent = detail;
      sub.hidden = false;
    } else {
      sub.textContent = "";
      sub.hidden = true;
    }
  }

  if (toastHideTimer) clearTimeout(toastHideTimer);
  if (toastDismissTimer) clearTimeout(toastDismissTimer);

  root.hidden = false;
  root.classList.remove("cart-toast--out");
  void root.offsetWidth;
  root.classList.add("cart-toast--visible");

  toastHideTimer = setTimeout(() => {
    root.classList.remove("cart-toast--visible");
    root.classList.add("cart-toast--out");
    toastDismissTimer = setTimeout(() => {
      root.hidden = true;
      root.classList.remove("cart-toast--out");
      if (main) main.textContent = "";
      if (sub) {
        sub.textContent = "";
        sub.hidden = true;
      }
      toastDismissTimer = undefined;
    }, 280);
    toastHideTimer = undefined;
  }, 5000);
}
