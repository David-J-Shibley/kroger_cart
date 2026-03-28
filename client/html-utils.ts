export function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML.replace(/"/g, "&quot;");
}

export function isSectionHeader(line: string): boolean {
  const s = (line || "").replace(/\*+$/g, "").trim();
  if (/^(meal\s*plan|grocery\s*list|shopping\s*list|ingredients\s*list)\s*:?\s*$/i.test(s))
    return true;
  if (/^day\s*\d+\s*$/i.test(s)) return true;
  if (/^meal\s*plan\s+for\s+/i.test(s)) return true;
  return false;
}

export function cleanGroceryLine(line: string): string {
  const s = (line || "").replace(/^\*+|\*+$/g, "").trim();
  return s.replace(/^[\-\*•·\d.]+\s*/, "").trim();
}

export function parseGroceryLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const result: string[] = [];
  let inList = false;
  const listHeaders = /^(grocery|shopping|ingredients)\s*list\s*:?\s*\**$/i;
  const looksLikeItem =
    /^[\-\*•·\d.]+\s*.+$|(\d+\s*(lb|oz|gallon|half-gallon|dozen|eggs?|cans?)\b|,\s*\d+)/i;
  for (const line of lines) {
    const normalized = (line || "").replace(/\*+$/g, "").trim();
    if (
      listHeaders.test(normalized) ||
      /^(grocery|shopping|ingredients)\s*list\s*:?\s*$/i.test(normalized)
    ) {
      inList = true;
      continue;
    }
    if (isSectionHeader(line)) continue;
    if (inList) {
      const cleaned = cleanGroceryLine(line);
      if (cleaned.length > 1 && !isSectionHeader(cleaned)) result.push(cleaned);
      continue;
    }
    if (looksLikeItem.test(line)) {
      const cleaned = cleanGroceryLine(line);
      if (cleaned.length > 1 && !isSectionHeader(cleaned)) result.push(cleaned);
    }
  }
  const fallback = lines
    .map((l) => cleanGroceryLine(l))
    .filter((l) => l.length > 2 && l.length < 120 && !isSectionHeader(l));
  return result.length ? result : fallback;
}

export function shortProductName(name: string): string {
  if (!name || typeof name !== "string") return name || "";
  const comma = name.indexOf(",");
  return comma > 0 ? name.slice(0, comma).trim() : name.trim();
}
