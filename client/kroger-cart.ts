/**
 * Browser entry — meal plan + grocery list + retailer cart integration.
 * Build: npm run build:client
 * HTML: <script type="module" src="dist/kroger-cart.js"></script>
 */

import { loadStoredKrogerAppToken } from "./app-state.js";
import { mergeAppAuth } from "./authed-fetch.js";
import { clearCognitoSession, getCognitoAccessToken } from "./auth-session.js";
import { openBillingPortal, subscribeToPlan } from "./billing.js";
import { SAVED_LLM_KEY } from "./config.js";
import { addItem } from "./add-to-cart.js";
import {
  addSuggestedItem,
  copyGroceryListToClipboard,
  generateGroceryList,
  loadSavedLLM,
  saveLLMToStorage,
} from "./grocery-generation.js";
import { initMealPlanForm } from "./meal-plan.js";
import {
  closeProductMetadata,
  closeProductPicker,
  pickProductAndAdd,
  showProductMetadata,
} from "./product-picker.js";
import { apiUrl, ensurePublicConfig, tryGetPublicConfig, type PublicConfig } from "./public-config.js";
import {
  signInWithKroger,
  signOutKroger,
  updateSignInUI,
} from "./kroger-tokens.js";

async function updateAccountBar(): Promise<void> {
  const bar = document.getElementById("accountAppBar");
  const btnIn = document.getElementById("btnAppSignIn");
  const btnOut = document.getElementById("btnAppSignOut");
  const btnSub = document.getElementById("btnSubscribe");
  const btnPortal = document.getElementById("btnBillingPortal");
  const statusEl = document.getElementById("accountStatus");
  const cfg = tryGetPublicConfig();
  if (!bar || !cfg) return;
  const canAppSignIn = Boolean(cfg.cognitoDomain && cfg.cognitoClientId);
  if (!cfg.authRequired && !canAppSignIn) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "";
  const tok = getCognitoAccessToken();
  const showAuthCtas = !tok && (cfg.authRequired || canAppSignIn);
  if (btnIn) btnIn.style.display = showAuthCtas ? "inline-block" : "none";
  const btnUp = document.getElementById("btnAppSignUp");
  if (btnUp) btnUp.style.display = showAuthCtas && canAppSignIn ? "inline-block" : "none";
  if (btnOut) btnOut.style.display = tok ? "inline-block" : "none";
  if (btnSub) btnSub.style.display = tok && cfg.subscriptionRequired ? "inline-block" : "none";
  if (btnPortal) btnPortal.style.display = tok ? "inline-block" : "none";
  if (statusEl) {
    if (!tok) {
      statusEl.textContent = "";
      return;
    }
    try {
      const r = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
      const j = (await r.json()) as { subscriptionStatus?: string; error?: string };
      if (r.ok && j.subscriptionStatus) {
        statusEl.textContent = "Plan: " + j.subscriptionStatus;
      } else {
        statusEl.textContent = "";
      }
    } catch {
      statusEl.textContent = "";
    }
  }
  const adminLink = document.getElementById("adminLink");
  if (adminLink) {
    adminLink.style.display = "none";
    if (tok && cfg.authRequired) {
      try {
        const ar = await fetch(apiUrl("/api/admin/status"), mergeAppAuth({ method: "GET" }));
        if (ar.ok) {
          const aj = (await ar.json()) as { admin?: boolean };
          if (aj.admin) adminLink.style.display = "";
        }
      } catch {
        /* ignore */
      }
    }
  }
}

function signOutApp(): void {
  clearCognitoSession();
  window.location.reload();
}

function goAppSignIn(): void {
  window.location.href = "/auth.html";
}

function goAppSignUp(): void {
  window.location.href = "/auth.html?signup=1";
}

function isAuthFlowPath(): boolean {
  const path = window.location.pathname || "";
  return path.endsWith("/auth.html") || path.endsWith("/auth-callback.html");
}

async function init(): Promise<void> {
  loadStoredKrogerAppToken();
  initMealPlanForm();
  let cfg: PublicConfig | null = null;
  try {
    cfg = await ensurePublicConfig();
  } catch (e) {
    console.error("Public config failed:", e);
    const boot = document.getElementById("bootError");
    if (boot) {
      boot.hidden = false;
      boot.textContent =
        "Could not load server configuration (/api/public-config). The app cannot enforce sign-in until the server is reachable. If you use Docker, ensure the app container loads your .env (see docker-compose env_file).";
    }
  }
  if (cfg && cfg.authRequired && !isAuthFlowPath()) {
    const tok = getCognitoAccessToken();
    if (!tok) {
      if (!cfg.authAllowAnonymousBrowsing) {
        window.location.href = "/";
        return;
      }
    } else {
      try {
        const r = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
        if (r.status === 401) {
          clearCognitoSession();
          window.location.href = "/";
          return;
        }
      } catch {
        /* offline: keep session, stay on page */
      }
    }
  }

  const guestBanner = document.getElementById("authBrowseBanner");
  if (guestBanner) {
    const showGuest =
      Boolean(cfg?.authRequired && cfg.authAllowAnonymousBrowsing && !getCognitoAccessToken());
    guestBanner.hidden = !showGuest;
  }
  if (localStorage.getItem(SAVED_LLM_KEY)) {
    const loadBtn = document.getElementById("loadSavedBtn");
    if (loadBtn) loadBtn.style.display = "";
  }
  updateSignInUI();
  const redirectEl = document.getElementById("redirectUriDisplay");
  if (redirectEl) {
    const c = tryGetPublicConfig();
    redirectEl.textContent = c?.krogerRedirectUri || window.location.origin + "/kroger-oauth-callback.html";
    if (c && !c.krogerClientId) {
      redirectEl.textContent += " (set KROGER_CLIENT_ID on the server)";
    }
  }
  await syncCheckoutIfNeeded();
  await updateAccountBar();
}

/** After Stripe redirect, activate subscription in DynamoDB (webhooks often miss localhost). */
async function syncCheckoutIfNeeded(): Promise<void> {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    const sessionId = params.get("session_id");
    if (!sessionId) return;
    const res = await fetch(
      apiUrl("/api/billing/sync-checkout"),
      mergeAppAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
    );
    const data = (await res.json()) as { ok?: boolean; error?: string; subscriptionStatus?: string };
    if (!res.ok) {
      const msg = data.error || "Could not confirm subscription (HTTP " + res.status + ")";
      console.warn("Checkout sync failed:", msg);
      alert(msg);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    url.searchParams.delete("session_id");
    const q = url.searchParams.toString();
    window.history.replaceState({}, "", url.pathname + (q ? "?" + q : "") + url.hash);
  } catch (e) {
    console.warn("syncCheckoutIfNeeded", e);
  }
}

declare global {
  interface Window {
    signInWithKroger: () => Promise<void>;
    signOutKroger: () => void;
    addItem: () => Promise<void>;
    closeProductPicker: () => void;
    generateGroceryList: () => Promise<void>;
    loadSavedLLM: () => void;
    saveLLMToStorage: () => void;
    copyGroceryListToClipboard: () => Promise<void>;
    addSuggestedItem: (btnOrLine: HTMLElement | string) => void;
    pickProductAndAdd: (index: number) => Promise<void>;
    showProductMetadata: (index: number) => void;
    closeProductMetadata: () => void;
    signOutApp: () => void;
    goAppSignIn: () => void;
    goAppSignUp: () => void;
    subscribeToPlan: () => Promise<void>;
    openBillingPortal: () => Promise<void>;
  }
}

window.signInWithKroger = signInWithKroger;
window.signOutKroger = signOutKroger;
window.addItem = addItem;
window.closeProductPicker = closeProductPicker;
window.generateGroceryList = generateGroceryList;
window.loadSavedLLM = loadSavedLLM;
window.saveLLMToStorage = saveLLMToStorage;
window.copyGroceryListToClipboard = copyGroceryListToClipboard;
window.addSuggestedItem = addSuggestedItem;
window.pickProductAndAdd = pickProductAndAdd;
window.showProductMetadata = showProductMetadata;
window.closeProductMetadata = closeProductMetadata;
window.signOutApp = signOutApp;
window.goAppSignIn = goAppSignIn;
window.goAppSignUp = goAppSignUp;
window.subscribeToPlan = subscribeToPlan;
window.openBillingPortal = openBillingPortal;

void init();
