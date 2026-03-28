const ACCESS_KEY = "appCognitoAccessToken";
const REFRESH_KEY = "appCognitoRefreshToken";

export function getCognitoAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

export function setCognitoTokens(access: string, refresh?: string): void {
  localStorage.setItem(ACCESS_KEY, access.replace(/\s+/g, "").trim());
  if (refresh) localStorage.setItem(REFRESH_KEY, String(refresh).trim());
}

export function clearCognitoSession(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}
