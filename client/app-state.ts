/** Mutable client state shared across modules. */
export const appState = {
  accessToken: null as string | null,
  lastGeneratedText: "",
  /** Human-readable portion of the last generated meal-plan text (without structured JSON tails). */
  generatedDisplayText: "",
  /** Structured meal plan JSON parsed from the latest LLM response (if present). */
  mealPlanJson: null as unknown | null,
};

export function loadStoredKrogerAppToken(): void {
  appState.accessToken = localStorage.getItem("krogerToken");
}