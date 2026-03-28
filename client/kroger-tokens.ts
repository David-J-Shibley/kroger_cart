import { appState } from "./app-state.js";
import { mergeAppAuth } from "./authed-fetch.js";
import { apiUrl, ensurePublicConfig, getPublicConfig } from "./public-config.js";
import type { TokenResponse } from "./types.js";

export function clearKrogerToken(): void {
  appState.accessToken = null;
  localStorage.removeItem("krogerToken");
  localStorage.removeItem("tokenExpiry");
}

export function getKrogerUserToken(): string | null {
  const token = localStorage.getItem("krogerUserToken");
  const expiry = localStorage.getItem("krogerUserTokenExpiry");
  if (!token) return null;
  const expiryMs = expiry ? parseInt(expiry, 10) : 0;
  if (expiryMs && !Number.isNaN(expiryMs) && Date.now() >= expiryMs) return null;
  return token.replace(/\s+/g, "").trim();
}

export function hasKrogerUserSession(): boolean {
  return !!getKrogerUserToken() || !!localStorage.getItem("krogerUserRefreshToken");
}

export async function getKrogerUserTokenOrRefresh(): Promise<string | null> {
  const token = getKrogerUserToken();
  if (token) return token;
  const refreshToken = localStorage.getItem("krogerUserRefreshToken");
  if (!refreshToken) return null;
  const krogerPath = window.location.protocol === "file:" ? "" : "/kroger-api";
  if (krogerPath !== "/kroger-api") return null;
  try {
    await ensurePublicConfig();
    const res = await fetch(
      apiUrl("/kroger-api/oauth-refresh"),
      mergeAppAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refreshToken: refreshToken.replace(/\s+/g, "").trim(),
        }),
      })
    );
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !data.access_token) {
      localStorage.removeItem("krogerUserRefreshToken");
      localStorage.removeItem("krogerUserToken");
      localStorage.removeItem("krogerUserTokenExpiry");
      return null;
    }
    const newToken = String(data.access_token).replace(/\s+/g, "").trim();
    const expiresIn =
      data.expires_in != null && data.expires_in > 0 ? data.expires_in * 1000 : 3600000;
    localStorage.setItem("krogerUserToken", newToken);
    localStorage.setItem("krogerUserTokenExpiry", String(Date.now() + expiresIn));
    if (data.refresh_token) {
      localStorage.setItem("krogerUserRefreshToken", String(data.refresh_token));
    }
    return newToken;
  } catch {
    localStorage.removeItem("krogerUserRefreshToken");
    localStorage.removeItem("krogerUserToken");
    localStorage.removeItem("krogerUserTokenExpiry");
    return null;
  }
}

export function updateSignInUI(): void {
  const hasUser = hasKrogerUserSession();
  const signInBtn = document.getElementById("krogerSignInBtn");
  const signedIn = document.getElementById("krogerSignedIn");
  if (signInBtn) signInBtn.style.display = hasUser ? "none" : "";
  if (signedIn) signedIn.style.display = hasUser ? "inline" : "none";
}

export async function signInWithKroger(): Promise<void> {
  await ensurePublicConfig();
  const cfg = getPublicConfig();
  if (!cfg.krogerClientId) {
    alert(
      "Kroger sign-in is not configured on the server. Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in the server environment."
    );
    return;
  }
  sessionStorage.setItem("krogerOAuthRedirectUri", cfg.krogerRedirectUri);
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem("krogerOAuthState", state);
  const scope = "product.compact%20cart.basic%3Awrite";
  const url =
    "https://api.kroger.com/v1/connect/oauth2/authorize?" +
    "client_id=" +
    encodeURIComponent(cfg.krogerClientId) +
    "&redirect_uri=" +
    encodeURIComponent(cfg.krogerRedirectUri) +
    "&response_type=code&scope=" +
    scope +
    "&state=" +
    encodeURIComponent(state);
  window.location.href = url;
}

export function signOutKroger(): void {
  localStorage.removeItem("krogerUserToken");
  localStorage.removeItem("krogerUserTokenExpiry");
  localStorage.removeItem("krogerUserRefreshToken");
  updateSignInUI();
}

export async function getAccessToken(): Promise<string> {
  const expiryRaw = localStorage.getItem("tokenExpiry");
  const expiry = expiryRaw != null ? (JSON.parse(expiryRaw) as number) : null;
  if (appState.accessToken && expiry && Date.now() < expiry) {
    const t = String(appState.accessToken).trim();
    if (t) return t;
  }

  const krogerPath = window.location.protocol === "file:" ? "" : "/kroger-api";
  const useServerToken = krogerPath === "/kroger-api";

  if (!useServerToken) {
    throw new Error(
      "Open this app from your server (http://localhost:8000/...) so product search can use secure Kroger credentials on the server."
    );
  }

  await ensurePublicConfig();
  const response = await fetch(
    apiUrl("/kroger-api/token"),
    mergeAppAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  );

  const tokenJson = (await response.json()) as TokenResponse;
  if (!tokenJson.access_token) {
    clearKrogerToken();
    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        "Failed to get access token (check server KROGER_CLIENT_ID / KROGER_CLIENT_SECRET)"
    );
  }

  const token = String(tokenJson.access_token).replace(/\s+/g, "").trim();
  if (token.length < 20) {
    clearKrogerToken();
    throw new Error("Token from Kroger was too short or invalid.");
  }
  const expiresIn =
    tokenJson.expires_in != null && tokenJson.expires_in > 0
      ? tokenJson.expires_in * 1000
      : 3600000;
  const expiryMs = Math.min(expiresIn, Math.max(0, expiresIn - 5 * 60 * 1000));
  appState.accessToken = token;
  localStorage.setItem("krogerToken", token);
  localStorage.setItem("tokenExpiry", String(Date.now() + expiryMs));
  return token;
}
