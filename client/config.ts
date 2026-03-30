/**
 * Client constants only — never put API secrets here (they ship in the browser bundle).
 * Kroger client ID, redirect URI, store location, and model come from static deploy-config.json.
 */
export const SAVED_LLM_KEY = "krogerCartSavedLLM";
/** Last chosen Featherless model id when deploy-config lists multiple `llmModels`. */
export const SAVED_LLM_MODEL_KEY = "krogerCartLlmModel";
/** User-pasted Kroger store URL → extracted location id (overrides deploy-config `krogerLocationId` when set). */
export const SAVED_KROGER_LOCATION_ID_KEY = "krogerCartKrogerLocationId";
export const SAVED_MEAL_PREFS_KEY = "krogerCartMealPrefs";

/** Auto-pick a product from Kroger search results instead of opening the chooser. */
export const AUTO_ADD_ENABLED_KEY = "krogerCartAutoAddEnabled";
export const AUTO_ADD_STRATEGY_KEY = "krogerCartAutoAddStrategy";
