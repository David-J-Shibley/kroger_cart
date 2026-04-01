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

export class AppState {
  accessToken: string | null;
  lastGeneratedText: string;
  generatedDisplayText: string;
  mealPlanJson: unknown | null;

  constructor() {
    this.accessToken = null;
    this.lastGeneratedText = "";
    this.generatedDisplayText = "";
    this.mealPlanJson = null;
  }

  setState(state: Partial<AppState>): void {
    Object.assign(this, state);
  }

  getState(): Partial<AppState> {
    return {
      accessToken: this.accessToken,
      lastGeneratedText: this.lastGeneratedText,
      generatedDisplayText: this.generatedDisplayText,
      mealPlanJson: this.mealPlanJson,
    };
  }

  resetState(): void {
    this.accessToken = null;
    this.lastGeneratedText = "";
    this.generatedDisplayText = "";
    this.mealPlanJson = null;
  }

  loadStoredState(): void {
    const storedState = localStorage.getItem("appState");
    if (storedState) {
      this.setState(JSON.parse(storedState));
    }
  }

  saveState(): void {
    localStorage.setItem("appState", JSON.stringify(this.getState()));
  }
}