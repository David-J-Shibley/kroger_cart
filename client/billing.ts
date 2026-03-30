import { mergeAppAuth } from "./authed-fetch.js";
import { apiUrl, ensurePublicConfig } from "./public-config.js";

export async function subscribeToPlan(): Promise<void> {
  try {
    await ensurePublicConfig();
    const res = await fetch(
      apiUrl("/api/billing/checkout-session"),
      mergeAppAuth({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    );
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok) {
      alert(data.error || "Could not start checkout (" + res.status + ")");
      return;
    }
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    alert("No checkout URL returned.");
  } catch (e) {
    alert("Checkout failed: " + (e instanceof Error ? e.message : e));
  }
}

export async function openBillingPortal(): Promise<void> {
  try {
    await ensurePublicConfig();
    const res = await fetch(
      apiUrl("/api/billing/portal"),
      mergeAppAuth({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    );
    const data = (await res.json()) as {
      url?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok) {
      if (data.error === "subscribe_first") {
        alert(
          typeof data.error_description === "string" && data.error_description.trim()
            ? data.error_description.trim()
            : "Click Subscribe in the header to start a subscription. Billing is for managing an existing plan."
        );
        return;
      }
      alert(data.error || "Could not open billing portal (" + res.status + ")");
      return;
    }
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    alert("No portal URL returned.");
  } catch (e) {
    alert("Billing portal failed: " + (e instanceof Error ? e.message : e));
  }
}
