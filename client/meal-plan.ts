import { SAVED_MEAL_PREFS_KEY } from "./config.js";

export interface MealPlanPrefs {
  people: number;
  days: number;
  includeBreakfast: boolean;
  includeLunch: boolean;
  includeDinner: boolean;
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
    ? `\n\nAdditional constraints from the user (follow these closely):\n${notes}\n`
    : "";

  const dayWord = days === 1 ? "1 day" : `${days} days`;
  const peopleWord = people === 1 ? "1 person" : `${people} people`;
  const listMin = Math.min(50, Math.max(15, 18 + people * 2 + Math.floor(days / 2)));
  const listMax = Math.min(80, Math.max(listMin + 5, 28 + people * 3 + days));

  return `Create a meal plan for ${dayWord} for a household of ${peopleWord}. ${scopeLine} Keep the meal plan brief.${notesBlock}

Then provide ONE consolidated grocery list for the entire period. Rules for the grocery list:
- Scale all quantities for ${peopleWord} across every meal in the plan.
- List each ingredient exactly ONCE. Add up all amounts needed across every recipe and write a single line per ingredient (e.g. "chicken breast, 4 lb" not separate lines for partial amounts).
- Use sensible units: milk and juice in gallons or half-gallons; eggs by count (e.g. "18 eggs"); meat and deli in lb; butter in lb or sticks; flour, sugar, rice in lb; produce in lb or count as appropriate (e.g. "3 onions", "2 lb carrots"); canned goods by count (e.g. "2 (15 oz) cans black beans"). Never use "lb" for liquids like milk.
- Keep the list concise: about ${listMin}–${listMax} line items total (adjust for household size). No duplicate ingredients. No lengthy recipes—just the meal plan and the grocery list.
- Put the grocery list under a clear heading on its own line: "Grocery list:" or "Shopping list:" followed by one item per line.
- Be concise: short meal names and list items only.`;
}

export function readMealPlanPrefsFromForm(): MealPlanPrefs {
  const peopleEl = document.getElementById("mealPlanPeople") as HTMLInputElement | null;
  const daysEl = document.getElementById("mealPlanDays") as HTMLInputElement | null;
  const bEl = document.getElementById("mealPlanBreakfast") as HTMLInputElement | null;
  const lEl = document.getElementById("mealPlanLunch") as HTMLInputElement | null;
  const dEl = document.getElementById("mealPlanDinner") as HTMLInputElement | null;
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
