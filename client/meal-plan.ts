import { SAVED_MEAL_PREFS_KEY } from "./config.js";

export interface MealPlanPrefs {
  people: number;
  days: number;
  includeBreakfast: boolean;
  includeLunch: boolean;
  includeDinner: boolean;
  /** When true, LLM adds a "Recipes:" section (ingredients + steps per dish) before the consolidated list. */
  includeRecipes: boolean;
  notes: string;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function defaultMealPlanPrefs(): MealPlanPrefs {
  return {
    people: 3,
    days: 7,
    includeBreakfast: true,
    includeLunch: true,
    includeDinner: true,
    includeRecipes: true,
    notes: "",
  };
}

/** Legacy `mealScope` from older saved JSON. */
type LegacyScope = "all" | "lunch_dinner" | "dinner_only";

function legacyScopeToMeals(scope: unknown): Pick<
  MealPlanPrefs,
  "includeBreakfast" | "includeLunch" | "includeDinner"
> {
  if (scope === "dinner_only") {
    return { includeBreakfast: false, includeLunch: false, includeDinner: true };
  }
  if (scope === "lunch_dinner") {
    return { includeBreakfast: false, includeLunch: true, includeDinner: true };
  }
  return { includeBreakfast: true, includeLunch: true, includeDinner: true };
}

export function parseStoredMealPrefs(raw: string | null): MealPlanPrefs {
  const d = defaultMealPlanPrefs();
  if (!raw) return d;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const fromLegacy =
      typeof o.mealScope === "string" ? legacyScopeToMeals(o.mealScope) : null;
    let includeBreakfast =
      typeof o.includeBreakfast === "boolean" ? o.includeBreakfast : fromLegacy?.includeBreakfast ?? d.includeBreakfast;
    let includeLunch =
      typeof o.includeLunch === "boolean" ? o.includeLunch : fromLegacy?.includeLunch ?? d.includeLunch;
    let includeDinner =
      typeof o.includeDinner === "boolean" ? o.includeDinner : fromLegacy?.includeDinner ?? d.includeDinner;
    if (!includeBreakfast && !includeLunch && !includeDinner) {
      includeBreakfast = true;
      includeLunch = true;
      includeDinner = true;
    }
    return {
      people: clampInt(Number(o.people), 1, 16),
      days: clampInt(Number(o.days), 1, 14),
      includeBreakfast,
      includeLunch,
      includeDinner,
      includeRecipes: typeof o.includeRecipes === "boolean" ? o.includeRecipes : d.includeRecipes,
      notes: typeof o.notes === "string" ? o.notes.slice(0, 800) : "",
    };
  } catch {
    return d;
  }
}

function buildMealsInstruction(prefs: MealPlanPrefs): string {
  const b = prefs.includeBreakfast;
  const l = prefs.includeLunch;
  const d = prefs.includeDinner;
  if (!b && !l && !d) {
    return "For each day list only dinner with specific dish names.";
  }
  const parts: string[] = [];
  if (b) parts.push("breakfast");
  if (l) parts.push("lunch");
  if (d) parts.push("dinner");
  return `For each day include only these meals, with specific dish names: ${parts.join(", ")}. Do not plan or list ingredients for any other meals.`;
}

/** User message sent to the LLM. */
export function buildMealPlanPrompt(prefs: MealPlanPrefs): string {
  const people = clampInt(prefs.people, 1, 16);
  const days = clampInt(prefs.days, 1, 14);
  const scopeLine = buildMealsInstruction(prefs);
  const notes = (prefs.notes || "").trim().slice(0, 800);
  const notesBlock = notes
    ? `\n\nAdditional constraints from the user (FOLLOW THESE STRICTLY — they override variety or convenience, and you must not violate them):\n${notes}\n`
    : "";

  const dayWord = days === 1 ? "1 day" : `${days} days`;
  const peopleWord = people === 1 ? "1 person" : `${people} people`;

  const listMin =
    days <= 1
      ? Math.min(30, Math.max(10, 12 + people * 2))
      : days === 2
        ? Math.min(40, Math.max(14, 15 + people * 2))
        : Math.min(50, Math.max(15, 18 + people * 2 + Math.floor(days / 2)));
  const listMax =
    days <= 1
      ? Math.min(35, Math.max(listMin + 3, 18 + people * 2))
      : days === 2
        ? Math.min(50, Math.max(listMin + 5, 22 + people * 2 + days))
        : Math.min(80, Math.max(listMin + 5, 28 + people * 3 + days));

  const strictDaysBlock =
    days === 1
      ? `Hard requirements for the day-by-day overview:
- Cover exactly 1 day only, labeled Day 1.
- Do not add Day 2, Day 3, or any higher day number. Do not output a full week, a 5-day work week, or extra days for variety.

`
      : `Hard requirements for the day-by-day overview:
- Cover exactly ${days} days, labeled Day 1 through Day ${days} only.
- Do not add extra days beyond Day ${days}, and do not substitute a full week or 5-day work week unless ${days} is 7 or 5 respectively.

`;

  const recipeExample =
    days === 1
      ? 'Day 1 — Lunch: Turkey sandwich'
      : 'Day 2 — Lunch: Turkey sandwich (format example only; your plan must stay within Day 1 through Day ' +
        String(days) +
        ' only)';
  const recipeFormatNote =
    days === 1
      ? "\n"
      : `\n(The example line shows format only; include recipes only for dishes on Day 1 through Day ${days} in your overview.)\n`;

  const recipeBlock = prefs.includeRecipes
    ? `

After the day-by-day overview, add a section that starts on its own line with exactly: Recipes:
Under Recipes, for every dish you listed in the day-by-day overview (each planned breakfast, lunch, and dinner), include a small block:
- A line with the day, meal type, and dish name (e.g. "${recipeExample}").${recipeFormatNote}- A line "Ingredients (for ${peopleWord} for this dish):" then a short bullet list with amounts for that dish only.
- A line "Steps:" then 3–6 numbered, concise steps (practical, not essay-length).

Do not put recipe ingredient bullets under any heading named "Grocery list" or "Shopping list"—those headings are reserved for the consolidated list below.`
    : `

Keep the day-by-day plan brief: short dish names only—no per-dish ingredient lists or cooking steps in the plan section.`;

  const safetyRules = `Safety and dietary rules (MUST follow all that apply based on the user's notes and common sense):
- If the user mentions allergies (e.g. nuts, shellfish, gluten) or intolerances (e.g. lactose intolerance), do not include any ingredient, recipe, or dish that conflicts with those restrictions.
- If the user says "lactose free", do not use regular milk, cream, cheese, yogurt, butter, or any other dairy ingredient that contains lactose. Use lactose-free or non-dairy alternatives only.
- If the user mentions vegetarian, vegan, pescatarian, or similar patterns, do not include dishes or ingredients that violate those patterns.
- When in doubt between a dish that might violate the notes and one that clearly fits, always choose the safer option that fully respects the notes.
- The user's notes are hard constraints, not suggestions. Never add an item that clearly conflicts with them, even if it would improve variety.`;

  const groceryRules = `Then provide ONE consolidated grocery list for the entire period. Rules for the grocery list:
- Scale all quantities for ${peopleWord} across every meal in the plan.
- List each ingredient exactly ONCE. Add up all amounts needed across every recipe and write a single line per ingredient (e.g. "chicken breast, 4 lb" not separate lines for partial amounts).
- Use sensible units: milk and juice in gallons or half-gallons; eggs by count (e.g. "18 eggs"); meat and deli in lb; butter in lb or sticks; flour, sugar, rice in lb; produce in lb or count as appropriate (e.g. "3 onions", "2 lb carrots"); canned goods by count (e.g. "2 (15 oz) cans black beans"). Never use "lb" for liquids like milk.
- Keep the list concise: about ${listMin}–${listMax} line items total (adjust for household size). No duplicate ingredients.
- Put the consolidated list ONLY under a line that reads exactly "Grocery list:" or "Shopping list:" (then one shopping item per line, bullet or plain). Nothing before that line belongs in the store list.`;

  const tailNote = prefs.includeRecipes
    ? `- After Recipes, output the consolidated grocery list as specified.
- Finally, at the VERY END of your response, output one more line: INGREDIENTS_JSON: followed by a single compact JSON object on the next line, with this exact shape (no comments, no extra text after it):
{"ingredients":[{"label":"chicken breast, 4 lb","name":"chicken breast","quantity":4,"unit":"lb"},{"label":"cucumbers, 3","name":"cucumbers","quantity":3,"unit":""}]}
The "label" must match exactly what you put in the grocery list line for that ingredient. Include every ingredient exactly once in this JSON array. Do not put any other text after the JSON.`
    : `- Be concise: short meal names and list items only.
- Finally, at the VERY END of your response, output one more line: INGREDIENTS_JSON: followed by a single compact JSON object on the next line, with this exact shape (no comments, no extra text after it):
{"ingredients":[{"label":"chicken breast, 4 lb","name":"chicken breast","quantity":4,"unit":"lb"},{"label":"cucumbers, 3","name":"cucumbers","quantity":3,"unit":""}]}
The "label" must match exactly what you would put in the grocery list line for that ingredient. Include every ingredient exactly once in this JSON array. Do not put any other text after the JSON.`;

  return `You are helping plan meals and a grocery list. You must obey all dietary restrictions, allergies, and other constraints described by the user even if that limits variety.

Create a meal plan for ${dayWord} for a household of ${peopleWord}. ${scopeLine}

${strictDaysBlock}Start with a clear day-by-day overview (each day: the meals you are including, with specific dish names).${notesBlock}

${safetyRules}
${recipeBlock}

${groceryRules}
${tailNote}`;
}

/** Max new tokens for LLM — recipes need a larger budget. */
export function mealPlanNumPredict(prefs: MealPlanPrefs): number {
  return prefs.includeRecipes ? 8192 : 2048;
}

export function readMealPlanPrefsFromForm(): MealPlanPrefs {
  const peopleEl = document.getElementById("mealPlanPeople") as HTMLInputElement | null;
  const daysEl = document.getElementById("mealPlanDays") as HTMLInputElement | null;
  const bEl = document.getElementById("mealPlanBreakfast") as HTMLInputElement | null;
  const lEl = document.getElementById("mealPlanLunch") as HTMLInputElement | null;
  const dEl = document.getElementById("mealPlanDinner") as HTMLInputElement | null;
  const recipesEl = document.getElementById("mealPlanRecipes") as HTMLInputElement | null;
  const notesEl = document.getElementById("mealPlanNotes") as HTMLTextAreaElement | null;
  let includeBreakfast = Boolean(bEl?.checked);
  let includeLunch = Boolean(lEl?.checked);
  let includeDinner = Boolean(dEl?.checked);
  if (!includeBreakfast && !includeLunch && !includeDinner) {
    includeBreakfast = true;
    includeLunch = true;
    includeDinner = true;
    if (bEl) bEl.checked = true;
    if (lEl) lEl.checked = true;
    if (dEl) dEl.checked = true;
  }
  return {
    people: clampInt(parseInt(peopleEl?.value ?? "3", 10), 1, 16),
    days: clampInt(parseInt(daysEl?.value ?? "7", 10), 1, 14),
    includeBreakfast,
    includeLunch,
    includeDinner,
    includeRecipes: recipesEl ? recipesEl.checked : true,
    notes: (notesEl?.value ?? "").slice(0, 800),
  };
}

function applyMealPlanPrefsToForm(prefs: MealPlanPrefs): void {
  const peopleEl = document.getElementById("mealPlanPeople") as HTMLInputElement | null;
  const daysEl = document.getElementById("mealPlanDays") as HTMLInputElement | null;
  const bEl = document.getElementById("mealPlanBreakfast") as HTMLInputElement | null;
  const lEl = document.getElementById("mealPlanLunch") as HTMLInputElement | null;
  const dEl = document.getElementById("mealPlanDinner") as HTMLInputElement | null;
  const notesEl = document.getElementById("mealPlanNotes") as HTMLTextAreaElement | null;
  if (peopleEl) peopleEl.value = String(clampInt(prefs.people, 1, 16));
  if (daysEl) daysEl.value = String(clampInt(prefs.days, 1, 14));
  if (bEl) bEl.checked = prefs.includeBreakfast;
  if (lEl) lEl.checked = prefs.includeLunch;
  if (dEl) dEl.checked = prefs.includeDinner;
  const recipesEl = document.getElementById("mealPlanRecipes") as HTMLInputElement | null;
  if (recipesEl) recipesEl.checked = prefs.includeRecipes;
  if (notesEl) notesEl.value = prefs.notes.slice(0, 800);
}

export function persistMealPlanPrefs(prefs: MealPlanPrefs): void {
  try {
    localStorage.setItem(SAVED_MEAL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota errors */
  }
}

export function initMealPlanForm(): void {
  applyMealPlanPrefsToForm(parseStoredMealPrefs(localStorage.getItem(SAVED_MEAL_PREFS_KEY)));
  const ids = [
    "mealPlanPeople",
    "mealPlanDays",
    "mealPlanBreakfast",
    "mealPlanLunch",
    "mealPlanDinner",
    "mealPlanRecipes",
    "mealPlanNotes",
  ];
  const onChange = (): void => persistMealPlanPrefs(readMealPlanPrefsFromForm());
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("change", onChange);
    if (el instanceof HTMLInputElement && el.type === "number") {
      el.addEventListener("input", onChange);
    }
    if (el instanceof HTMLTextAreaElement) {
      el.addEventListener("input", onChange);
    }
  }
}
