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
  { key: "housing", label: "Housing", guideline_pct: 28, guideline_kind: "max",
    guideline_source: "CFP guideline: total housing (mortgage/rent + taxes + insurance) ≤28% of take-home.",
    role: "fixed", description: "Mortgage, rent, HOA, property taxes, home repairs, lawn care.",
    match_keywords: ["mortgage", "rent", "hoa", "lawn", "home repair", "house", "household", "property tax", "yard"] },
  { key: "utilities", label: "Utilities", guideline_pct: 7, guideline_kind: "max",
    guideline_source: "Utilities (electric, water, gas, trash, internet, phone) — typically 5–7% of take-home.",
    role: "fixed", description: "Electric, water, gas, trash, internet, cell phone bills.",
    match_keywords: ["electric", "water", "gas bill", "internet", "spectrum", "phone", "cell", "trash", "dominion", "utility", "utilities"] },
  { key: "insurance", label: "Insurance", guideline_pct: 10, guideline_kind: "max",
    guideline_source: "Combined insurance (health, life, disability, auto, home, pet) — typically ≤10% of take-home.",
    role: "fixed", description: "Health, life, disability, auto, home, renters, pet insurance.",
    match_keywords: ["insurance", "ltd", "disability", "term life", "policy", "premium"] },
  { key: "debt", label: "Debt Service", guideline_pct: 15, guideline_kind: "max",
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
  { key: "personal", label: "Personal", guideline_pct: 10, guideline_kind: "max",
    guideline_source: "Personal & lifestyle (clothing, hobbies, self-care, miscellaneous) — typically ≤10% combined.",
    role: "variable", description: "Clothing, hobbies, self-care, personal spending money.",
    match_keywords: ["personal", "clothing", "clothes", "hair", "salon", "barber", "beauty", "spa", "hobby", "hobbies", "joe", "katie", "spending", "random", "misc"] },
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
  { key: "gifts", label: "Gifts", guideline_pct: 2, guideline_kind: "max",
    guideline_source: "Gift-giving (birthdays, Christmas, weddings) — typically ≤2% of take-home.",
    role: "variable", description: "Gifts for birthdays, Christmas, weddings, baby showers.",
    match_keywords: ["gift", "gifts", "birthday", "christmas", "wedding", "shower", "present"] },
  { key: "medical", label: "Medical", guideline_pct: 5, guideline_kind: "max",
    guideline_source: "Out-of-pocket medical (copays, prescriptions, dental) — typically ≤5% of take-home.",
    role: "variable", description: "Doctor, dentist, pharmacy, copays, prescriptions.",
    match_keywords: ["medical", "doctor", "dentist", "pharmacy", "prescription", "copay", "health", "urgent care"] },
  { key: "subscriptions", label: "Subscriptions", guideline_pct: 2, guideline_kind: "max",
    guideline_source: "Recurring digital subscriptions (streaming, software, memberships) — typically ≤2% of take-home.",
    role: "variable", description: "Streaming, software, gym memberships, recurring subscriptions.",
    match_keywords: ["subscription", "subscriptions", "streaming", "netflix", "spotify", "hulu", "gym", "membership", "software"] },
  { key: "travel", label: "Travel", guideline_pct: 5, guideline_kind: "max",
    guideline_source: "Travel & vacation — typically ≤5% of take-home, often saved into a sinking fund.",
    role: "variable", description: "Vacations, flights, hotels, travel.",
    match_keywords: ["travel", "vacation", "flight", "hotel", "airbnb", "trip"] },
];

export const VARIABLE_BUCKETS = CFP_BUCKETS.filter(b => b.role === "variable");
export const FIXED_BUCKETS = CFP_BUCKETS.filter(b => b.role === "fixed");

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
