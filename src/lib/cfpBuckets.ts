// Client mirror of supabase/functions/_shared/cfp-buckets.ts.
// Kept in sync manually — edit both files together when changing the taxonomy.

export interface CfpBucket {
  key: string;
  label: string;
  guideline_pct: number;
  guideline_kind: "max" | "min" | "target";
  guideline_source: string;
  role: "variable" | "fixed";
  description: string;
  match_keywords: string[];
}

export const CFP_BUCKETS: CfpBucket[] = [
  { key: "giving", label: "Giving", guideline_pct: 10, guideline_kind: "min",
    guideline_source: "Tithe / generosity baseline (10%) — common stewardship anchor.",
    role: "fixed", description: "Tithe, charitable giving, missions, non-profit donations.",
    match_keywords: ["tithe", "giving", "church", "missions", "charity", "donation", "offering", "kingdom"] },
  { key: "saving", label: "Saving & Investing", guideline_pct: 15, guideline_kind: "min",
    guideline_source: "CFP retirement-readiness guideline of 10–15% of gross income.",
    role: "fixed", description: "Transfers to savings, retirement contributions, sinking funds.",
    match_keywords: ["saving", "savings", "invest", "retirement", "401k", "ira", "roth", "brokerage", "sinking", "emergency fund"] },
  { key: "housing", label: "Housing", guideline_pct: 33, guideline_kind: "max",
    guideline_source: "Total monthly housing cost (mortgage/rent + taxes + insurance + utilities) ≤33% of take-home — extends the classic CFP 28% PITI rule to include utilities, which a typical household pays alongside the housing bill.",
    role: "fixed", description: "Mortgage, rent, HOA, property taxes, home repairs, lawn care, electric, water, gas, trash, internet, cell phone.",
    match_keywords: ["mortgage", "rent", "hoa", "lawn", "home repair", "house", "household", "property tax", "yard", "electric", "water", "gas bill", "internet", "spectrum", "phone", "cell", "trash", "dominion", "utility", "utilities"] },
  { key: "insurance", label: "Insurance", guideline_pct: 3, guideline_kind: "max",
    guideline_source: "Standalone insurance only — excludes homeowners (in housing escrow) and auto (in transportation). Term life, disability, and umbrella policies typically ≤3% of take-home.",
    role: "fixed", description: "Standalone insurance: term life, disability, umbrella. Excludes homeowners (escrowed with mortgage) and auto (in transportation).",
    match_keywords: ["insurance", "ltd", "disability", "term life", "policy", "premium", "umbrella"] },
  { key: "non_housing_debt", label: "Non-Housing Debt", guideline_pct: 15, guideline_kind: "max",
    guideline_source: "Non-mortgage debt service (auto, student, credit card payoff) — CFP 36% rule less housing.",
    role: "fixed", description: "Student loan, auto loan, personal loan, credit card payoff.",
    match_keywords: ["loan", "debt", "payoff", "student loan", "auto loan"] },
  { key: "transportation", label: "Transportation", guideline_pct: 8, guideline_kind: "max",
    guideline_source: "Variable transportation (fuel, parking, rideshare, repairs) — typically ≤8% of take-home outside of car payments.",
    role: "variable", description: "Gas, parking, rideshare, public transit, auto repair.",
    match_keywords: ["gas", "fuel", "parking", "uber", "lyft", "rideshare", "transit", "auto repair", "oil change", "tolls", "transportation", "car"] },
  { key: "groceries", label: "Groceries", guideline_pct: 12, guideline_kind: "max",
    guideline_source: "USDA / CFP food-at-home guideline: roughly 8–12% of take-home for a family.",
    role: "variable", description: "Supermarkets, food at home, household staples.",
    match_keywords: ["grocery", "groceries", "food", "supermarket", "publix", "kroger", "aldi", "walmart"] },
  { key: "eating_out", label: "Eating Out", guideline_pct: 5, guideline_kind: "max",
    guideline_source: "CFP discretionary food guideline: dining out ≤5% of take-home.",
    role: "variable", description: "Restaurants, fast food, coffee shops, takeout, delivery.",
    match_keywords: ["eat", "eating", "restaurant", "dining", "takeout", "delivery", "coffee", "fast food", "doordash", "ubereats", "bar", "eo"] },
  { key: "lifestyle", label: "Lifestyle", guideline_pct: 12, guideline_kind: "max",
    guideline_source: "Combined discretionary lifestyle (clothing, hobbies, subscriptions, gifts, personal spending) — derived from the 50/30/20 framework's 'wants' allocation, scaled to support 10%+ giving and 15%+ saving.",
    role: "variable", description: "Clothing, hobbies, self-care, personal spending, streaming, software, memberships, gifts (birthdays, Christmas, weddings).",
    match_keywords: ["personal", "clothing", "clothes", "hair", "salon", "barber", "beauty", "spa", "hobby", "hobbies", "joe", "katie", "spending", "random", "misc", "subscription", "subscriptions", "streaming", "netflix", "spotify", "hulu", "gym", "membership", "software", "gift", "gifts", "birthday", "christmas", "wedding", "shower", "present"] },
  { key: "kids", label: "Kids", guideline_pct: 10, guideline_kind: "max",
    guideline_source: "Kids' direct expenses (activities, school, supplies) — varies widely; 5–10% is a common range.",
    role: "variable", description: "Daycare, school, kids' activities, kids' clothing, supplies.",
    match_keywords: ["kid", "kids", "child", "children", "daycare", "school", "tuition", "diaper", "baby", "toy"] },
  { key: "pets", label: "Pets", guideline_pct: 2, guideline_kind: "max",
    guideline_source: "Routine pet costs (food, grooming, vet basics) — typically ≤2% of take-home.",
    role: "variable", description: "Pet food, grooming, vet, pet supplies.",
    match_keywords: ["pet", "pets", "dog", "cat", "vet", "groomer", "chewy", "petsmart"] },
  { key: "hosting", label: "Hosting", guideline_pct: 3, guideline_kind: "target",
    guideline_source: "Hospitality / community meals — a stewardship-informed line; typically 1–3% of take-home.",
    role: "variable", description: "Hospitality, community meals, hosting guests.",
    match_keywords: ["hosting", "hospitality", "guests", "community meal"] },
  { key: "medical", label: "Medical", guideline_pct: 5, guideline_kind: "max",
    guideline_source: "Out-of-pocket medical (copays, prescriptions, dental) — typically ≤5% of take-home.",
    role: "variable", description: "Doctor, dentist, pharmacy, copays, prescriptions.",
    match_keywords: ["medical", "doctor", "dentist", "pharmacy", "prescription", "copay", "health", "urgent care"] },
  { key: "travel", label: "Travel", guideline_pct: 5, guideline_kind: "max",
    guideline_source: "Travel & vacation — typically ≤5% of take-home, often saved into a sinking fund.",
    role: "variable", description: "Vacations, flights, hotels, travel.",
    match_keywords: ["travel", "vacation", "flight", "hotel", "airbnb", "trip"] },
];

export const VARIABLE_BUCKETS = CFP_BUCKETS.filter(b => b.role === "variable");
export const FIXED_BUCKETS = CFP_BUCKETS.filter(b => b.role === "fixed");

/**
 * Bucket keys that have been removed from the taxonomy. If the database still
 * has a mapping referencing one of these (e.g. after a future taxonomy change
 * before its migration runs), the UI should detect it and prompt the user to
 * re-map. The Apr 2026 migration auto-remapped these to the keys listed here.
 */
export const RETIRED_BUCKET_KEYS: Record<string, string> = {
  utilities: "housing",
  subscriptions: "lifestyle",
  gifts: "lifestyle",
  personal: "lifestyle",
  debt: "non_housing_debt",
};

export function isRetiredBucket(key: string): boolean {
  return key in RETIRED_BUCKET_KEYS;
}

export function getBucket(key: string): CfpBucket | undefined {
  return CFP_BUCKETS.find(b => b.key === key);
}

/**
 * Suggest a CFP bucket for a category based on its name (and optionally its
 * group). Deterministic keyword match — no AI. Returns null if no match.
 */
export function suggestBucket(name: string, group?: string): string | null {
  // Note: We intentionally do NOT auto-route group='savings'/'tithe'/'giving'
  // to the Saving/Giving buckets. Many "savings" categories are actually
  // sinking funds for delayed expenses (vacation savings → Travel, car taxes
  // → Transportation, dog savings → Pets). Only true Saving (retirement,
  // emergency fund, brokerage) and true Giving (tithe, charity) belong in
  // those buckets — the user knows which is which. Keyword match still kicks
  // in below for obvious cases (e.g. "retirement" → Saving).
  const n = (name || "").toLowerCase();
  if (!n) return null;

  let best: { key: string; score: number } | null = null;
  for (const b of CFP_BUCKETS) {
    let score = 0;
    for (const kw of b.match_keywords) {
      if (n.includes(kw)) score += kw.length;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { key: b.key, score };
    }
  }
  return best?.key ?? null;
}
