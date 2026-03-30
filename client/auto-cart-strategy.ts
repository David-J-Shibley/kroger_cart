import type { PickerProduct } from "./types.js";

/** Words ignored when matching the shopper’s line to a product title. */
const TOKEN_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "with",
  "to",
  "oz",
  "lb",
  "ct",
  "pack",
  "each",
  "per",
  "loaf",
  "slices",
  "slice",
]);

/**
 * Flavor / niche descriptors in the product name that we softly avoid when the search line
 * does not mention them — reduces “cheapest = random onion bread” when the list just said “bread”.
 */
const FLAVOR_MISMATCH_TERMS: readonly string[] = [
  "onion",
  "garlic",
  "jalapeno",
  "jalapeño",
  "habanero",
  "buffalo",
  "sriracha",
  "cinnamon",
  "raisin",
  "cranberry",
  "blueberry",
  "pumpkin",
  "marble",
  "swirl",
  "pumpernickel",
  "truffle",
  "pretzel",
  "focaccia",
  "cornbread",
  "brioche",
  "challah",
  "zucchini",
  "mochi",
  "ube",
  "asiago",
  "pickle",
  "kimchi",
  "chocolate",
  "strawberry",
  "vanilla",
  "mocha",
  "everything",
  "poppy",
  "sesame",
  "potato",
  "rye",
  "sourdough",
  "naan",
  "pita",
  "tortilla",
  "wrap",
  "mini",
  "cocktail",
  "bite",
  "snack",
];

export type AutoCartStrategy =
  | "default"
  | "cheapest"
  | "premium"
  | "healthiest"
  | "organic_first"
  | "store_brand";

const STRATEGIES: readonly AutoCartStrategy[] = [
  "default",
  "cheapest",
  "premium",
  "healthiest",
  "organic_first",
  "store_brand",
];

export function parseAutoCartStrategy(raw: string | null | undefined): AutoCartStrategy {
  const s = (raw || "").trim();
  if (STRATEGIES.includes(s as AutoCartStrategy)) return s as AutoCartStrategy;
  return "cheapest";
}

function haystack(p: PickerProduct): string {
  const bits = [p.name || ""];
  try {
    if (p.raw && typeof p.raw === "object") {
      bits.push(JSON.stringify(p.raw));
    }
  } catch {
    /* ignore */
  }
  return bits.join(" ").toLowerCase();
}

function tokenizeForMatch(s: string): string[] {
  const cleaned = s
    .toLowerCase()
    .replace(/\d+(\.\d+)?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return cleaned
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !TOKEN_STOPWORDS.has(t));
}

/** How well the Kroger listing title matches the line the user searched (higher = better). */
function searchLineProductFit(searchLine: string, productName: string): number {
  const q = (searchLine || "").trim();
  const name = (productName || "").toLowerCase();
  if (!q || !name) return 0;
  const qt = tokenizeForMatch(q);
  if (qt.length === 0) return 0;
  let hits = 0;
  for (const t of qt) {
    if (name.includes(t)) hits += 1;
  }
  const qCompact = q.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const nCompact = name.replace(/[^a-z0-9]+/g, "");
  if (qCompact.length >= 3 && nCompact.includes(qCompact)) hits += 2;
  return hits;
}

/** Penalty when the product title implies a flavor/variant the search line did not ask for. */
function flavorMismatchPenalty(searchLine: string, productName: string): number {
  const ql = (searchLine || "").toLowerCase();
  const nl = (productName || "").toLowerCase();
  let pen = 0;
  for (const term of FLAVOR_MISMATCH_TERMS) {
    if (nl.includes(term) && !ql.includes(term)) pen += 2;
  }
  return pen;
}

/** Combined fit: prefer stronger text match and fewer surprise flavor words. */
function autoPickRankScore(searchLine: string, p: PickerProduct): number {
  const q = (searchLine || "").trim();
  if (!q) return 0;
  return searchLineProductFit(q, p.name) * 5 - flavorMismatchPenalty(q, p.name);
}

function pickCheapest(products: PickerProduct[], searchLine?: string): PickerProduct {
  const withPrice = products.filter((p) => p.price > 0);
  const pool = withPrice.length ? withPrice : products;
  const q = (searchLine || "").trim();
  if (!q) {
    return [...pool].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))[0];
  }
  return [...pool].sort((a, b) => {
    const ra = autoPickRankScore(q, a);
    const rb = autoPickRankScore(q, b);
    if (rb !== ra) return rb - ra;
    return a.price - b.price || a.name.localeCompare(b.name);
  })[0];
}

function pickPremium(products: PickerProduct[], searchLine?: string): PickerProduct {
  const withPrice = products.filter((p) => p.price > 0);
  const pool = withPrice.length ? withPrice : products;
  const q = (searchLine || "").trim();
  if (!q) {
    return [...pool].sort((a, b) => b.price - a.price || a.name.localeCompare(b.name))[0];
  }
  return [...pool].sort((a, b) => {
    const ra = autoPickRankScore(q, a);
    const rb = autoPickRankScore(q, b);
    if (rb !== ra) return rb - ra;
    return b.price - a.price || a.name.localeCompare(b.name);
  })[0];
}

/** Positive signals in product name / raw JSON (Kroger facets vary). */
const HEALTH_PATTERNS: { re: RegExp; w: number }[] = [
  { re: /\busda\s+organic\b/i, w: 6 },
  { re: /\borganic\b/i, w: 4 },
  { re: /\bnon[-\s]?gmo\b/i, w: 3 },
  { re: /\bwhole\s+grain\b/i, w: 2 },
  { re: /\b100%\s+whole\s+wheat\b/i, w: 2 },
  { re: /\bgrass[-\s]?fed\b/i, w: 2 },
  { re: /\bpasture[\s-]?raised\b/i, w: 2 },
  { re: /\bwild[\s-]?caught\b/i, w: 2 },
  { re: /\bno\s+added\s+sugar\b/i, w: 2 },
  { re: /\blow\s+sodium\b/i, w: 2 },
  { re: /\bunsweetened\b/i, w: 1 },
  { re: /\bplant[-\s]?based\b/i, w: 1 },
  { re: /\bvegan\b/i, w: 1 },
  { re: /\bheart\s+healthy\b/i, w: 2 },
  { re: /\bhigh\s+fiber\b/i, w: 1 },
];

const HEALTH_NEGATIVE: { re: RegExp; w: number }[] = [
  { re: /\bartificial\b/i, w: -1 },
  { re: /\bhigh\s+fructose\b/i, w: -2 },
];

function healthScore(p: PickerProduct): number {
  const text = haystack(p);
  let score = 0;
  for (const { re, w } of HEALTH_PATTERNS) {
    if (re.test(text)) score += w;
  }
  for (const { re, w } of HEALTH_NEGATIVE) {
    if (re.test(text)) score += w;
  }
  return score;
}

function pickHealthiest(products: PickerProduct[]): PickerProduct {
  const scored = products.map((p) => ({ p, s: healthScore(p) }));
  scored.sort((a, b) => b.s - a.s || a.p.price - b.p.price || a.p.name.localeCompare(b.p.name));
  if (scored[0].s > 0) return scored[0].p;
  return products[0];
}

function pickOrganicFirst(products: PickerProduct[], searchLine?: string): PickerProduct {
  const organic = products.filter((p) => /\borganic\b/i.test(haystack(p)));
  if (organic.length) return pickCheapest(organic, searchLine);
  return pickHealthiest(products);
}

/** Prefer Kroger / store-owned lines when the API returns them. */
const STORE_BRAND_RE =
  /\b(simple\s+truth|private\s+selection|heritage\s+farm|hemis['']?\s*farms|kroger\s+naturals?|kroger\s+brand)\b/i;

function pickStoreBrand(products: PickerProduct[], searchLine?: string): PickerProduct {
  const branded = products.filter((p) => STORE_BRAND_RE.test(haystack(p)));
  if (branded.length) return pickCheapest(branded, searchLine);
  return products[0];
}

/**
 * Choose one product from Kroger search hits. Caller must pass a non-empty list.
 * `searchLine` should be the same text used for Kroger search (e.g. shortened grocery line) so
 * cheapest/premium can prefer listings that match the line and avoid odd flavor SKUs.
 */
export function pickProductByStrategy(
  products: PickerProduct[],
  strategy: AutoCartStrategy,
  searchLine?: string
): PickerProduct {
  if (products.length <= 1) return products[0];
  switch (strategy) {
    case "default":
      return products[0];
    case "cheapest":
      return pickCheapest(products, searchLine);
    case "premium":
      return pickPremium(products, searchLine);
    case "healthiest":
      return pickHealthiest(products);
    case "organic_first":
      return pickOrganicFirst(products, searchLine);
    case "store_brand":
      return pickStoreBrand(products, searchLine);
    default:
      return products[0];
  }
}

export function autoStrategyLabel(strategy: AutoCartStrategy): string {
  switch (strategy) {
    case "default":
      return "top search result";
    case "cheapest":
      return "lowest price among closer text matches (heuristic)";
    case "premium":
      return "highest price among closer text matches (heuristic)";
    case "healthiest":
      return "strongest healthy-label signals (organic, whole grain, etc.)";
    case "organic_first":
      return "organic if available, else health signals";
    case "store_brand":
      return "store brand / Simple Truth / Private Selection when listed";
    default:
      return strategy;
  }
}
