import type { PickerProduct } from "./types.js";

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

function pickCheapest(products: PickerProduct[]): PickerProduct {
  const withPrice = products.filter((p) => p.price > 0);
  const pool = withPrice.length ? withPrice : products;
  return [...pool].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))[0];
}

function pickPremium(products: PickerProduct[]): PickerProduct {
  const withPrice = products.filter((p) => p.price > 0);
  const pool = withPrice.length ? withPrice : products;
  return [...pool].sort((a, b) => b.price - a.price || a.name.localeCompare(b.name))[0];
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

function pickOrganicFirst(products: PickerProduct[]): PickerProduct {
  const organic = products.filter((p) => /\borganic\b/i.test(haystack(p)));
  if (organic.length) return pickCheapest(organic);
  return pickHealthiest(products);
}

/** Prefer Kroger / store-owned lines when the API returns them. */
const STORE_BRAND_RE =
  /\b(simple\s+truth|private\s+selection|heritage\s+farm|hemis['']?\s*farms|kroger\s+naturals?|kroger\s+brand)\b/i;

function pickStoreBrand(products: PickerProduct[]): PickerProduct {
  const branded = products.filter((p) => STORE_BRAND_RE.test(haystack(p)));
  if (branded.length) return pickCheapest(branded);
  return products[0];
}

/**
 * Choose one product from Kroger search hits. Caller must pass a non-empty list.
 */
export function pickProductByStrategy(products: PickerProduct[], strategy: AutoCartStrategy): PickerProduct {
  if (products.length <= 1) return products[0];
  switch (strategy) {
    case "default":
      return products[0];
    case "cheapest":
      return pickCheapest(products);
    case "premium":
      return pickPremium(products);
    case "healthiest":
      return pickHealthiest(products);
    case "organic_first":
      return pickOrganicFirst(products);
    case "store_brand":
      return pickStoreBrand(products);
    default:
      return products[0];
  }
}

export function autoStrategyLabel(strategy: AutoCartStrategy): string {
  switch (strategy) {
    case "default":
      return "top search result";
    case "cheapest":
      return "lowest price among matches";
    case "premium":
      return "highest price among matches";
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
