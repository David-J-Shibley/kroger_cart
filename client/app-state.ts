/** Mutable client state shared across modules. */
export const appState = {
  accessToken: null as string | null,
  lastGeneratedText: "",
};

export function loadStoredKrogerAppToken(): void {
  appState.accessToken = localStorage.getItem("krogerToken");
}
