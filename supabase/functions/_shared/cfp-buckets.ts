// CFP-style spending buckets used by the Spending Analyzer.
// Guideline percentages are anchors widely cited in Certified Financial Planner
// (CFP) and stewardship literature. They guide conversation, not hard rules.
//
// "role":
//   "variable" — buckets typically driven by user discretion month-to-month
//                (groceries, eating out, lifestyle, etc.). The AI commentary
//                step focuses suggestions and reallocation hints here.
//   "fixed"    — buckets typically paid via recurring bills (housing, insurance,
//                non-housing debt) or structural intent (giving, saving). Shown
//                for context so the framework adds to ~100% of take-home.
//
// Apr 2026 taxonomy update:
//   - `utilities` merged into `housing` (28% → 33% to absorb utilities)
//   - `subscriptions`, `gifts`, `personal` merged into `lifestyle` (12% max)
//   - `debt` renamed to `non_housing_debt`
// See RETIRED_BUCKET_KEYS for the legacy → new mapping used by the safety net.

export interface CfpBucket {
  key: string;
  label: string;
  guideline_pct: number;        // target % of monthly take-home
  guideline_kind: "max" | "min" | "target";
  guideline_source: string;     // shown in the info popover in the UI
  role: "variable" | "fixed";
  description: string;
  match_keywords: string[];
}

export const CFP_BUCKETS: CfpBucket[] = [
  // ---------- Fixed / structural buckets ----------
  {
    key: "giving",
    label: "Giving",
    guideline_pct: 10,
    guideline_kind: "min",
    guideline_source: "Tithe / generosity baseline (10%) — common stewardship anchor.",
    role: "fixed",
    description: "Tithe, charitable giving, missions, non-profit donations.",
    match_keywords: ["tithe", "giving", "church", "missions", "charity", "donation", "offering", "kingdom"],
  },
  {
    key: "saving",
    label: "Saving & Investing",
    guideline_pct: 15,
    guideline_kind: "min",
    guideline_source: "CFP retirement-readiness guideline of 10–15% of gross income.",
    role: "fixed",
    description: "Transfers to savings, retirement contributions, sinking funds.",
    match_keywords: ["saving", "savings", "invest", "retirement", "401k", "ira", "roth", "brokerage", "sinking", "emergency fund"],
  },
  {
    key: "housing",
    label: "Housing",
    guideline_pct: 33,
    guideline_kind: "max",
    guideline_source: "Total monthly housing cost (mortgage/rent + taxes + insurance + utilities) ≤33% of take-home — extends the classic CFP 28% PITI rule to include utilities, which a typical household pays alongside the housing bill.",
    role: "fixed",
    description: "Mortgage, rent, HOA, property taxes, home repairs, lawn care, electric, water, gas, trash, internet, cell phone.",
    match_keywords: ["mortgage", "rent", "hoa", "lawn", "home repair", "house", "household", "property tax", "yard", "electric", "water", "gas bill", "internet", "spectrum", "phone", "cell", "trash", "dominion", "utility", "utilities"],
  },
  {
    key: "insurance",
    label: "Insurance",
    guideline_pct: 3,
    guideline_kind: "max",
    guideline_source: "Standalone insurance only — excludes homeowners (in housing escrow) and auto (in transportation). Term life, disability, and umbrella policies typically ≤3% of take-home.",
    role: "fixed",
    description: "Standalone insurance: term life, disability, umbrella. Excludes homeowners (escrowed with mortgage) and auto (in transportation).",
    match_keywords: ["insurance", "ltd", "disability", "term life", "policy", "premium", "umbrella"],
  },
  {
    key: "non_housing_debt",
    label: "Non-Housing Debt",
    guideline_pct: 15,
    guideline_kind: "max",
    guideline_source: "Non-mortgage debt service (auto, student, credit card payoff) — CFP 36% rule less housing.",
    role: "fixed",
    description: "Student loan, auto loan, personal loan, credit card payoff.",
    match_keywords: ["loan", "debt", "payoff", "student loan", "auto loan"],
  },

  // ---------- Variable / discretionary buckets ----------
  {
    key: "transportation",
    label: "Transportation",
    guideline_pct: 8,
    guideline_kind: "max",
    guideline_source: "Variable transportation (fuel, parking, rideshare, repairs) — typically ≤8% of take-home outside of car payments.",
    role: "variable",
    description: "Gas, parking, rideshare, public transit, auto repair.",
    match_keywords: ["gas", "fuel", "parking", "uber", "lyft", "rideshare", "transit", "auto repair", "oil change", "tolls", "transportation", "car"],
  },
  {
    key: "groceries",
    label: "Groceries",
    guideline_pct: 12,
    guideline_kind: "max",
    guideline_source: "USDA / CFP food-at-home guideline: roughly 8–12% of take-home for a family.",
    role: "variable",
    description: "Supermarkets, food at home, household staples.",
    match_keywords: ["grocery", "groceries", "food", "supermarket", "publix", "kroger", "aldi", "walmart"],
  },
  {
    key: "eating_out",
    label: "Eating Out",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "CFP discretionary food guideline: dining out ≤5% of take-home.",
    role: "variable",
    description: "Restaurants, fast food, coffee shops, takeout, delivery.",
    match_keywords: ["eat", "eating", "restaurant", "dining", "takeout", "delivery", "coffee", "fast food", "doordash", "ubereats", "bar", "eo"],
  },
  {
    key: "lifestyle",
    label: "Lifestyle",
    guideline_pct: 12,
    guideline_kind: "max",
    guideline_source: "Combined discretionary lifestyle (clothing, hobbies, subscriptions, gifts, personal spending) — derived from the 50/30/20 framework's 'wants' allocation, scaled to support 10%+ giving and 15%+ saving.",
    role: "variable",
    description: "Clothing, hobbies, self-care, personal spending, streaming, software, memberships, gifts (birthdays, Christmas, weddings).",
    match_keywords: ["personal", "clothing", "clothes", "hair", "salon", "barber", "beauty", "spa", "hobby", "hobbies", "joe", "katie", "spending", "random", "misc", "subscription", "subscriptions", "streaming", "netflix", "spotify", "hulu", "gym", "membership", "software", "gift", "gifts", "birthday", "christmas", "wedding", "shower", "present"],
  },
  {
    key: "kids",
    label: "Kids",
    guideline_pct: 10,
    guideline_kind: "max",
    guideline_source: "Kids' direct expenses (activities, school, supplies) — varies widely; 5–10% is a common range.",
    role: "variable",
    description: "Daycare, school, kids' activities, kids' clothing, supplies.",
    match_keywords: ["kid", "kids", "child", "children", "daycare", "school", "tuition", "diaper", "baby", "toy"],
  },
  {
    key: "pets",
    label: "Pets",
    guideline_pct: 2,
    guideline_kind: "max",
    guideline_source: "Routine pet costs (food, grooming, vet basics) — typically ≤2% of take-home.",
    role: "variable",
    description: "Pet food, grooming, vet, pet supplies.",
    match_keywords: ["pet", "pets", "dog", "cat", "vet", "groomer", "chewy", "petsmart"],
  },
  {
    key: "hosting",
    label: "Hosting",
    guideline_pct: 3,
    guideline_kind: "target",
    guideline_source: "Hospitality / community meals — a stewardship-informed line; typically 1–3% of take-home.",
    role: "variable",
    description: "Hospitality, community meals, hosting guests.",
    match_keywords: ["hosting", "hospitality", "guests", "community meal"],
  },
  {
    key: "medical",
    label: "Medical",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "Out-of-pocket medical (copays, prescriptions, dental) — typically ≤5% of take-home.",
    role: "variable",
    description: "Doctor, dentist, pharmacy, copays, prescriptions.",
    match_keywords: ["medical", "doctor", "dentist", "pharmacy", "prescription", "copay", "health", "urgent care"],
  },
  {
    key: "travel",
    label: "Travel",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "Travel & vacation — typically ≤5% of take-home, often saved into a sinking fund.",
    role: "variable",
    description: "Vacations, flights, hotels, travel.",
    match_keywords: ["travel", "vacation", "flight", "hotel", "airbnb", "trip"],
  },
];

export const VARIABLE_BUCKET_KEYS = CFP_BUCKETS.filter(b => b.role === "variable").map(b => b.key);
export const FIXED_BUCKET_KEYS = CFP_BUCKETS.filter(b => b.role === "fixed").map(b => b.key);
export const ALL_BUCKET_KEYS = CFP_BUCKETS.map(b => b.key);

/**
 * Legacy bucket keys → current bucket keys. Used both by the one-time data
 * migration (Apr 2026) and as a server-side safety net so the analyzer never
 * crashes on a stale mapping if a future taxonomy change ships before its
 * migration runs.
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

/**
 * Suggest a CFP bucket for a category based on its name (and optionally its
 * group). Deterministic keyword match — no AI. Returns null if no confident
 * match. Used for smart defaults in the bucket picker.
 */
export function suggestBucket(name: string, group?: string): string | null {
  // Note: We intentionally do NOT auto-route group='savings'/'tithe'/'giving'
  // to the Saving/Giving buckets. Many "savings" categories are sinking funds
  // for delayed expenses (vacation savings → Travel, car taxes → Transportation,
  // dog savings → Pets). The user picks. Keyword match still kicks in below.
  const n = (name || "").toLowerCase();
  if (!n) return null;

  // Score each bucket by how many of its keywords appear in the name. Pick
  // the highest-scoring bucket, but only if there's at least one hit.
  let best: { key: string; score: number } | null = null;
  for (const b of CFP_BUCKETS) {
    let score = 0;
    for (const kw of b.match_keywords) {
      if (n.includes(kw)) score += kw.length; // longer keyword = stronger signal
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { key: b.key, score };
    }
  }
  return best?.key ?? null;
}
