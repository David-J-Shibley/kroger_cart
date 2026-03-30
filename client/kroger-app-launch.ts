/**
 * After bulk add-to-cart, offer to open Kroger (app via universal link when available, else website).
 */
export const KROGER_SHOPPING_CART_URL = "https://www.kroger.com/shopping/cart";

let bulkBannerWired = false;

function wireBulkDoneBannerOnce(): void {
  if (bulkBannerWired) return;
  bulkBannerWired = true;
  document.getElementById("krogerBulkDoneOpenBtn")?.addEventListener("click", () => {
    window.open(KROGER_SHOPPING_CART_URL, "_blank", "noopener,noreferrer");
  });
  document.getElementById("krogerBulkDoneDismissBtn")?.addEventListener("click", () => {
    dismissKrogerBulkDoneBanner();
  });
}

export function dismissKrogerBulkDoneBanner(): void {
  const el = document.getElementById("krogerBulkDoneBanner");
  if (el) el.hidden = true;
}

/** Call when at least one grocery line was added via bulk actions. */
export function showBulkAddKrogerFollowup(added: number, failed: number): void {
  if (added <= 0) return;
  wireBulkDoneBannerOnce();
  const banner = document.getElementById("krogerBulkDoneBanner");
  const msg = document.getElementById("krogerBulkDoneBannerMessage");
  if (!banner || !msg) return;

  const lines =
    added === 1 ? "1 line was" : `${added} lines were`;
  const failPart = failed
    ? ` ${failed} line${failed === 1 ? "" : "s"} could not be added (see any alerts above).`
    : "";
  msg.textContent = `${lines} added to your Kroger cart.${failPart}`;

  banner.hidden = false;
  banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
