export function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML.replace(/"/g, "&quot;");
}

export function isSectionHeader(line: string): boolean {
  const s = (line || "").replace(/\*+$/g, "").trim();
  if (/^(meal\s*plan|grocery\s*list|shopping\s*list|ingredients\s*list)\s*:?\s*$/i.test(s))
    return true;
  /** "Day 1", "Day 1:", "DAY 3" — plan structure, not SKUs */
  if (/^day\s*\d+\s*:?\s*$/i.test(s)) return true;
  if (/^meal\s*plan\s+for\s+/i.test(s)) return true;
  if (/^recipes\s*:?\s*$/i.test(s)) return true;
  return false;
}

/** Strip leading ATX markdown (# …) for classification only. */
function stripLeadingMarkdownHeading(line: string): string {
  return (line || "").replace(/^\s*#{1,6}\s*/, "").trim();
}

/**
 * Meal-plan / recipe scaffolding (markdown headings, day labels, section titles).
 * Must not become "grocery" rows or add-to-cart lines.
 */
export function isStructuralPlanLine(line: string): boolean {
  const raw = (line || "").trim();
  if (!raw) return true;

  if (/^#{1,6}(\s+\S|\s*$)/.test(raw)) return true;

  const s = stripLeadingMarkdownHeading(raw);
  const cleaned = cleanGroceryLine(s.length ? s : raw);

  if (isSectionHeader(raw) || isSectionHeader(s) || isSectionHeader(cleaned)) return true;
  if (isMealPlanLine(raw) || isMealPlanLine(s) || isMealPlanLine(cleaned)) return true;

  if (/^day\s*\d+\s*[—\-–]\s*\S/i.test(cleaned)) return true;
  if (/^day\s*\d+\s*:\s*\S/i.test(cleaned)) return true;
  if (/^day\s*\d+\b/i.test(cleaned) && cleaned.length < 48) return true;

  if (/day[\s\-–]+by[\s\-–]+day/i.test(cleaned)) return true;
  if (/\boverview\b/i.test(cleaned) && /day|meal|plan/i.test(cleaned)) return true;

  if (/^recipes?\s*:?\s*$/i.test(cleaned)) return true;
  if (/^ingredients\s*(\(|:)/i.test(cleaned)) return true;
  if (/^steps?\s*:?\s*$/i.test(cleaned)) return true;

  if (/^#{1,6}\s*\S/.test(cleaned)) return true;

  return false;
}

export function cleanGroceryLine(line: string): string {
  const s = (line || "").replace(/^\*+|\*+$/g, "").trim();
  return s.replace(/^[\-\*•·\d.]+\s*/, "").trim();
}

function isLikelyGroceryItem(line: string): boolean {
  const s = (line || "").trim();
  if (!s) return false;

  // Filter out obvious recipe step lines starting with common cooking verbs.
  if (
    /^(preheat|cook|bake|simmer|boil|grill|roast|stir|mix|combine|whisk|season|serve|let\s+rest|let\s+cool|arrange|top|fold|pour|transfer|spread|layer|chill|marinate|drain|rinse)\b/i.test(
      s
    )
  ) {
    return false;
  }

  // If it looks like "Name, 2 cups" or "Name - 2 cups", treat as ingredient.
  if (/[,\-–]\s*\d/.test(s)) return true;

  // If it contains a quantity and a unit, it is very likely an ingredient.
  if (
    /\b\d+(\.\d+)?\s*(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|kilogram|kilograms|ml|milliliter|milliliters|l|liter|litre|liters|clove|cloves|slice|slices|can|cans|package|packages|stick|sticks|head|heads|bunch|bunches|pinch|dash|bag|bags|jar|jars|quart|quarts|pint|pints|gal|gallon|gallons)\b/i.test(
      s
    )
  ) {
    return true;
  }

  // Simple "Name, amount" without unit (e.g. "eggs, 3") is also fine.
  if (/^[^,]+,\s*\d+(\.\d+)?\b/.test(s)) return true;

  // Lines like "salt and pepper to taste" (no explicit number) should still count.
  if (/\bto taste\b/i.test(s)) return true;

  // If there is no number at all and it didn't match any of the above
  // ingredient-style patterns, treat it as non-grocery (likely a step or heading).
  if (!/\d/.test(s)) return false;

  // If we have a number but no clear unit, be conservative and require at least a comma split,
  // e.g. "eggs, 3" was already handled above. Most remaining numeric sentences are likely steps.
  return false;
}

/** Lightweight filter for cart labels coming from structured JSON. Only blocks obvious instructions. */
export function isIngredientLabelForCart(line: string): boolean {
  const s = (line || "").trim();
  if (!s) return false;
  // Reuse the same leading-verb heuristic to filter steps like "Add black beans..." etc.
  if (
    /^(preheat|cook|bake|simmer|boil|grill|roast|stir|mix|combine|whisk|season|serve|let\s+rest|let\s+cool|arrange|top|fold|pour|transfer|spread|layer|chill|marinate|drain|rinse|toast|toss|place|add)\b/i.test(
      s
    )
  ) {
    return false;
  }
  return true;
}

/** Meal-plan rows like "Breakfast: Oatmeal" or "- Lunch: Sandwiches" — not grocery SKUs. */
export function isMealPlanLine(line: string): boolean {
  const s = cleanGroceryLine(line).trim();
  return /^(breakfast|brunch|lunch|dinner|supper|snack)\s*:/i.test(s);
}

export function parseGroceryLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const result: string[] = [];
  let inList = false;
  /** Only grocery/shopping — never "ingredients list" (recipe sections can use that wording). */
  const listHeaders = /^(grocery|shopping)\s*list\s*:?\s*\**$/i;
  for (const line of lines) {
    const normalized = (line || "").replace(/^\*+|\*+$/g, "").trim();
    if (listHeaders.test(normalized) || /^(grocery|shopping)\s*list\s*:?\s*$/i.test(normalized)) {
      inList = true;
      continue;
    }
    if (isSectionHeader(line)) continue;
    if (isMealPlanLine(line)) continue;
    if (inList) {
      const cleaned = cleanGroceryLine(line);
      if (
        cleaned.length > 1 &&
        !isStructuralPlanLine(line) &&
        !isStructuralPlanLine(cleaned) &&
        isLikelyGroceryItem(cleaned)
      ) {
        result.push(cleaned);
      }
      continue;
    }
    /** Do not ingest bullet lines before the grocery header (recipe ingredients would match). */
  }
  let fallbackLines = lines;
  const tailMatch = text.match(/(?:^|\n)\s*(?:grocery|shopping)\s*list\s*:?\s*(?:\n|$)/im);
  if (tailMatch && typeof tailMatch.index === "number") {
    const after = text.slice(tailMatch.index + tailMatch[0].length);
    const tail = after.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (tail.length) fallbackLines = tail;
  }
  const fallback = fallbackLines
    .map((l) => cleanGroceryLine(l))
    .filter((l, i) => {
      const raw = fallbackLines[i] ?? l;
      const looksLikeItem =
        l.length > 2 &&
        l.length < 120 &&
        !isStructuralPlanLine(raw) &&
        !isStructuralPlanLine(l) &&
        isLikelyGroceryItem(l);
      return looksLikeItem;
    });
  const base = result.length ? result : fallback;

  // Try to aggregate quantities for repeated ingredients.
  type Aggregated = { name: string; unit: string; quantity: number } | null;

  function parseQuantityToken(token: string): number | null {
    const t = token.trim();
    if (!t) return null;
    // Simple decimal, e.g. "1", "2.5"
    if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    // Mixed number, e.g. "1 1/2"
    const mixedMatch = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
    if (mixedMatch) {
      const whole = parseInt(mixedMatch[1], 10);
      const num = parseInt(mixedMatch[2], 10);
      const den = parseInt(mixedMatch[3], 10);
      if (!isNaN(whole) && !isNaN(num) && !isNaN(den) && den !== 0) {
        return whole + num / den;
      }
    }
    // Simple fraction, e.g. "1/2"
    const fracMatch = /^(\d+)\/(\d+)$/.exec(t);
    if (fracMatch) {
      const num = parseInt(fracMatch[1], 10);
      const den = parseInt(fracMatch[2], 10);
      if (!isNaN(num) && !isNaN(den) && den !== 0) {
        return num / den;
      }
    }
    return null;
  }

  function parseAggregated(line: string): Aggregated {
    const s = line.trim();
    if (!s) return null;

    // Pattern: "name, qty unit..." (recommended by the prompt, e.g. "cucumbers, 2" or "chicken breast, 4 lb")
    const commaIdx = s.indexOf(",");
    if (commaIdx > 0 && commaIdx < s.length - 1) {
      const name = s.slice(0, commaIdx).trim();
      const rest = s.slice(commaIdx + 1).trim();
      if (name && rest) {
        const parts = rest.split(/\s+/);
        const qty = parseQuantityToken(parts[0] || "");
        if (qty !== null) {
          const unit = parts.slice(1).join(" ").trim();
          return { name: name.toLowerCase(), unit: unit.toLowerCase(), quantity: qty };
        }
      }
    }

    // Fallback: "qty unit name" (e.g. "2 lb chicken breast")
    const parts = s.split(/\s+/);
    if (parts.length >= 2) {
      const qty = parseQuantityToken(parts[0] || "");
      if (qty !== null) {
        const unit = parts[1] || "";
        const name = parts.slice(2).join(" ").trim();
        if (name) {
          return { name: name.toLowerCase(), unit: unit.toLowerCase(), quantity: qty };
        }
      }
    }

    return null;
  }

  const aggregated = new Map<string, Aggregated>();
  const passthrough: string[] = [];

  for (const line of base) {
    const parsed = parseAggregated(line);
    if (!parsed) {
      passthrough.push(line);
      continue;
    }
    const key = parsed.name + "||" + parsed.unit;
    const existing = aggregated.get(key);
    if (existing) {
      existing.quantity += parsed.quantity;
    } else {
      aggregated.set(key, { ...parsed });
    }
  }

  const out: string[] = [];

  for (const [key, value] of aggregated.entries()) {
    if (!value) continue;
    const qty =
      Number.isInteger(value.quantity) && Math.abs(value.quantity) < 1e6
        ? String(value.quantity)
        : value.quantity.toFixed(2).replace(/\.00$/, "");
    const prettyName = value.name;
    const prettyUnit = value.unit;
    const line =
      prettyUnit && prettyUnit.length
        ? `${prettyName}, ${qty} ${prettyUnit}`.trim()
        : `${prettyName}, ${qty}`;
    out.push(line);
  }

  // Append passthrough lines, keeping their original order but avoiding duplicates with aggregated lines.
  const seen = new Set(out);
  for (const line of passthrough) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }

  return out;
}

export function shortProductName(name: string): string {
  if (!name || typeof name !== "string") return name || "";
  const comma = name.indexOf(",");
  return comma > 0 ? name.slice(0, comma).trim() : name.trim();
}
