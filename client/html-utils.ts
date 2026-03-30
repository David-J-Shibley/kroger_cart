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
        !isStructuralPlanLine(cleaned)
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
      return (
        l.length > 2 &&
        l.length < 120 &&
        !isStructuralPlanLine(raw) &&
        !isStructuralPlanLine(l)
      );
    });
  return result.length ? result : fallback;
}

export function shortProductName(name: string): string {
  if (!name || typeof name !== "string") return name || "";
  const comma = name.indexOf(",");
  return comma > 0 ? name.slice(0, comma).trim() : name.trim();
}
