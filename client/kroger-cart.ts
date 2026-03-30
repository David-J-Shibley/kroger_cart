/**
 * Browser entry — meal plan + grocery list + retailer cart integration.
 * Build: npm run build:client
 * HTML: <script type="module" src="dist/kroger-cart.js"></script>
 */

import { loadStoredKrogerAppToken } from "./app-state.js";
import { mergeAppAuth } from "./authed-fetch.js";
import { clearCognitoSession, getCognitoAccessToken } from "./auth-session.js";
import { dismissKrogerBulkDoneBanner } from "./kroger-app-launch.js";
import { openBillingPortal, subscribeToPlan } from "./billing.js";
import { SAVED_LLM_KEY } from "./config.js";
import { addItem } from "./add-to-cart.js";
import {
  addAllGroceryToCart,
  addSelectedGroceryToCart,
  addSuggestedItem,
  copyGroceryListToClipboard,
  generateGroceryList,
  loadExampleMealPlan,
  loadSavedLLM,
  saveLLMToStorage,
  setAllGroceryLineChecks,
} from "./grocery-generation.js";
import { initAutoCartPreferencesUi } from "./auto-cart-ui.js";
import { initMealPlanForm } from "./meal-plan.js";
import {
  closeProductMetadata,
  closeProductPicker,
  pickProductAndAdd,
  showProductMetadata,
} from "./product-picker.js";
import { apiUrl, ensurePublicConfig, tryGetPublicConfig, type PublicConfig } from "./public-config.js";
import {
  refreshKrogerLinkedFromApi,
  signInWithKroger,
  signOutKroger,
  updateSignInUI,
} from "./kroger-tokens.js";

async function isAppSignedIn(): Promise<boolean> {
  const cfg = tryGetPublicConfig();
  if (!cfg) return false;
  if (cfg.cookieSessionAuth) {
    try {
      const r = await fetch(apiUrl("/api/me"), mergeAppAuth({ method: "GET" }));
      return r.ok;
    } catch {
      return false;
    }
  }
  return Boolean(getCognitoAccessToken());
}

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
  const signedIn = await isAppSignedIn();
  const showAuthCtas = !signedIn && (cfg.authRequired || canAppSignIn);
  if (btnIn) btnIn.style.display = showAuthCtas ? "inline-block" : "none";
  const btnUp = document.getElementById("btnAppSignUp");
  if (btnUp) btnUp.style.display = showAuthCtas && canAppSignIn ? "inline-block" : "none";
  if (btnOut) btnOut.style.display = signedIn ? "inline-block" : "none";
  if (btnSub) btnSub.style.display = signedIn && cfg.subscriptionRequired ? "inline-block" : "none";
  if (btnPortal) btnPortal.style.display = signedIn ? "inline-block" : "none";
  if (statusEl) {
    if (!signedIn) {
      statusEl.textContent = "";
    } else {
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
  }
  const adminLink = document.getElementById("adminLink");
  if (adminLink) {
    adminLink.style.display = "none";
    if (signedIn && cfg.authRequired) {
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

async function signOutApp(): Promise<void> {
  const cfg = tryGetPublicConfig();
  try {
    if (cfg?.cookieSessionAuth) {
      await fetch(apiUrl("/api/auth/session"), mergeAppAuth({ method: "DELETE" }));
    }
  } catch {
    /* ignore */
  }
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
  initAutoCartPreferencesUi();
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
    const signedIn = await isAppSignedIn();
    if (!signedIn) {
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
    const signedInGuest = await isAppSignedIn();
    const showGuest = Boolean(cfg?.authRequired && cfg.authAllowAnonymousBrowsing && !signedInGuest);
    guestBanner.hidden = !showGuest;
  }
  if (localStorage.getItem(SAVED_LLM_KEY)) {
    const loadBtn = document.getElementById("loadSavedBtn");
    if (loadBtn) loadBtn.style.display = "";
  }
  const loadExampleBtn = document.getElementById("loadExampleBtn");
  if (loadExampleBtn) {
    loadExampleBtn.hidden = !cfg?.testMode;
  }
  if (cfg?.cookieSessionAuth) {
    await refreshKrogerLinkedFromApi();
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
    signOutKroger: () => Promise<void>;
    addItem: () => Promise<void>;
    closeProductPicker: () => void;
    generateGroceryList: () => Promise<void>;
    loadExampleMealPlan: () => void;
    loadSavedLLM: () => void;
    saveLLMToStorage: () => void;
    copyGroceryListToClipboard: () => Promise<void>;
    addAllGroceryToCart: () => Promise<void>;
    addSelectedGroceryToCart: () => Promise<void>;
    setAllGroceryLineChecks: (checked: boolean) => void;
    addSuggestedItem: (btnOrLine: HTMLElement | string) => void;
    pickProductAndAdd: (index: number) => Promise<void>;
    showProductMetadata: (index: number) => void;
    closeProductMetadata: () => void;
    signOutApp: () => Promise<void>;
    goAppSignIn: () => void;
    goAppSignUp: () => void;
    subscribeToPlan: () => Promise<void>;
    openBillingPortal: () => Promise<void>;
    dismissKrogerBulkDoneBanner: () => void;
  }
}

window.signInWithKroger = signInWithKroger;
window.signOutKroger = signOutKroger;
window.addItem = addItem;
window.closeProductPicker = closeProductPicker;
window.generateGroceryList = generateGroceryList;
window.loadExampleMealPlan = loadExampleMealPlan;
window.loadSavedLLM = loadSavedLLM;
window.saveLLMToStorage = saveLLMToStorage;
window.copyGroceryListToClipboard = copyGroceryListToClipboard;
window.addAllGroceryToCart = addAllGroceryToCart;
window.addSelectedGroceryToCart = addSelectedGroceryToCart;
window.setAllGroceryLineChecks = setAllGroceryLineChecks;
window.addSuggestedItem = addSuggestedItem;
window.pickProductAndAdd = pickProductAndAdd;
window.showProductMetadata = showProductMetadata;
window.closeProductMetadata = closeProductMetadata;
window.signOutApp = signOutApp;
window.goAppSignIn = goAppSignIn;
window.goAppSignUp = goAppSignUp;
window.subscribeToPlan = subscribeToPlan;
window.openBillingPortal = openBillingPortal;
window.dismissKrogerBulkDoneBanner = dismissKrogerBulkDoneBanner;

void init();
