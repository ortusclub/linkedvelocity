// Canonical industry taxonomy for the public catalogue.
//
// The customer-facing catalogue (filter buttons, colored tags) is built around these
// five short buckets — see `catalogue-view.tsx` (INDUSTRY_COLORS + the filter row) and
// the server-side filter in `api/accounts/route.ts` (exact match on `industry`).
//
// Historically a few writers (the admin Inventory dropdown and the Level-4 profile
// generator) stored LinkedIn's long official industry names instead ("Information
// Technology & Services", "Business Consulting & Services", …). Those render as long,
// colorless chips and never match a filter button. `toIndustryBucket` folds any such
// legacy/long value back into one of the five buckets so the site stays uniform.
export const INDUSTRY_BUCKETS = ["Sales", "Marketing", "Technology", "Operations", "Finance"] as const;
export type IndustryBucket = (typeof INDUSTRY_BUCKETS)[number];

// Long / legacy labels → short bucket (keys are lower-cased + trimmed for matching).
const INDUSTRY_ALIASES: Record<string, IndustryBucket> = {
  "information technology & services": "Technology",
  "it & services": "Technology",
  "computer software": "Technology",
  "software development": "Technology",
  "marketing & advertising": "Marketing",
  "advertising services": "Marketing",
  "financial services": "Finance",
  "business consulting & services": "Sales",
  "customer service": "Operations",
  "staffing & recruiting": "Operations",
};

/**
 * Normalize any stored industry value to its short catalogue bucket.
 * - Known long/legacy names map to a bucket.
 * - Values that are already a canonical bucket return in canonical casing.
 * - Anything unrecognized is returned trimmed (so we never blank out real data).
 * - Empty / null → null.
 */
export function toIndustryBucket(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  const lc = t.toLowerCase();
  if (INDUSTRY_ALIASES[lc]) return INDUSTRY_ALIASES[lc];
  const canon = INDUSTRY_BUCKETS.find((b) => b.toLowerCase() === lc);
  return canon ?? t;
}
