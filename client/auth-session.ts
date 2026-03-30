const ACCESS_KEY = "appCognitoAccessToken";
const REFRESH_KEY = "appCognitoRefreshToken";
const ID_KEY = "appCognitoIdToken";

export function getCognitoAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

/** Cognito ID token — includes `email` for server verification (access token often does not). */
export function getCognitoIdToken(): string | null {
  try {
    return localStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}

export function setCognitoTokens(access: string, refresh?: string, idToken?: string): void {
  localStorage.setItem(ACCESS_KEY, access.replace(/\s+/g, "").trim());
  if (refresh) localStorage.setItem(REFRESH_KEY, String(refresh).trim());
  if (idToken) localStorage.setItem(ID_KEY, String(idToken).replace(/\s+/g, "").trim());
}

export function clearCognitoSession(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(ID_KEY);
}
