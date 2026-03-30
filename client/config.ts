/**
 * Client constants only — never put API secrets here (they ship in the browser bundle).
 * Kroger client ID, redirect URI, and store location come from static deploy-config.json (LLM model is server env).
 */
export const SAVED_LLM_KEY = "krogerCartSavedLLM";
/** User-pasted Kroger store URL → extracted location id (overrides deploy-config `krogerLocationId` when set). */
export const SAVED_KROGER_LOCATION_ID_KEY = "krogerCartKrogerLocationId";
export const SAVED_MEAL_PREFS_KEY = "krogerCartMealPrefs";

/** Auto-pick a product from Kroger search results instead of opening the chooser. */
export const AUTO_ADD_ENABLED_KEY = "krogerCartAutoAddEnabled";
export const AUTO_ADD_STRATEGY_KEY = "krogerCartAutoAddStrategy";
