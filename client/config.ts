/**
 * Client constants only — never put API secrets here (they ship in the browser bundle).
 * Kroger client ID, redirect URI, store location, and default model come from GET /api/public-config.
 */
export const OLLAMA_API_PATH = "/ollama-api";

export const SAVED_LLM_KEY = "krogerCartSavedLLM";
export const SAVED_MEAL_PREFS_KEY = "krogerCartMealPrefs";
