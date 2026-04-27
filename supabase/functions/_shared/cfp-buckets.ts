// CFP-style spending buckets used by the Spending Analyzer.
// Guideline percentages are rough anchors widely cited in CFP and stewardship
// literature. They are anchors for conversation, not hard rules.
//
// "role":
//   "variable" — buckets typically driven by user discretion month-to-month.
//                Always shown; AI provides suggested totals + commentary.
//   "fixed"    — buckets typically paid via recurring bills (mortgage,
//                utilities, insurance, debt service, giving, saving). Always
//                shown so the framework adds up to ~100% of take-home, but
//                rendered as informational unless the user asks to retune them.

export interface CfpBucket {
  key: string;
  label: string;
  guideline_pct: number;        // target % of monthly take-home
  guideline_kind: "max" | "min" | "target";
  guideline_source: string;     // shown in info tooltip in UI
  role: "variable" | "fixed";
  // Slug substrings (lowercased) that map a household category to this bucket.
  slug_matchers: string[];
  // Name keywords (lowercased) used as a fallback when slug doesn't match.
  name_keywords: string[];
}

export const CFP_BUCKETS: CfpBucket[] = [
  // ---------- Fixed / structural buckets (informational, sum to ~41%) ----------
  {
    key: "giving",
    label: "Giving",
    guideline_pct: 10,
    guideline_kind: "min",
    guideline_source: "Tithe / generosity baseline (10%) — common stewardship anchor.",
    role: "fixed",
    slug_matchers: [
      "tithe", "giving", "generosity", "offering", "missions", "charity",
      "radius", "ccc", "co-ef", "campus-outreach", "od", "original-design",
    ],
    name_keywords: ["tithe", "giving", "generosity", "offering", "missions", "charity", "church", "campus outreach"],
  },
  {
    key: "saving",
    label: "Saving & Investing",
    guideline_pct: 15,
    guideline_kind: "min",
    guideline_source: "CFP retirement-readiness guideline of 10–15% of gross.",
    role: "fixed",
    slug_matchers: [
      "savings", "save-", "invest", "retirement", "ira", "401k", "brokerage",
      "emergency", "emergency-fund", "cars-savings", "dog-savings",
      "hoa", "vacation-savings", "lpl---thomas",
    ],
    name_keywords: ["savings", "investment", "retirement", "ira", "401k", "brokerage", "emergency fund", "sinking fund"],
  },
  {
    key: "housing",
    label: "Housing",
    guideline_pct: 28,
    guideline_kind: "max",
    guideline_source: "CFP guideline: total housing (mortgage/rent + taxes + insurance) ≤28% of take-home.",
    role: "fixed",
    slug_matchers: [
      "mortgage", "rent", "house-payment", "household", "home-repair", "home-maint",
      "lawn", "hoa-fee",
    ],
    name_keywords: ["mortgage", "rent", "household", "lawn", "home repair", "home maintenance"],
  },
  {
    key: "utilities",
    label: "Utilities",
    guideline_pct: 7,
    guideline_kind: "max",
    guideline_source: "Utilities (electric, water, gas, trash, internet, phone) — typically 5–7% of take-home.",
    role: "fixed",
    slug_matchers: [
      "util", "electric", "dominion", "water", "gas-bill", "natural-gas",
      "internet", "spectrum", "phone", "cell", "trash", "garbage",
    ],
    name_keywords: ["electric", "dominion", "water", "internet", "spectrum", "phone", "cell", "trash", "garbage", "utility", "utilities"],
  },
  {
    key: "insurance",
    label: "Insurance",
    guideline_pct: 10,
    guideline_kind: "max",
    guideline_source: "Combined insurance (health, life, disability, auto, home, pet) — typically ≤10% of take-home.",
    role: "fixed",
    slug_matchers: [
      "insurance", "ltd", "lpl-ltd", "pets-best", "seed-inc", "term-life",
      "auto-insurance", "home-insurance", "renters-insurance",
    ],
    name_keywords: ["insurance", "ltd", "disability", "term life", "pets best", "policy"],
  },
  {
    key: "debt",
    label: "Debt Service",
    guideline_pct: 15,
    guideline_kind: "max",
    guideline_source: "Non-mortgage debt service (auto, student, credit card payoff) — CFP 36% rule less housing.",
    role: "fixed",
    slug_matchers: [
      "debt", "loan-payment", "student-loan", "auto-loan", "car-loan",
      "credit-card-payoff", "perritt", "tahoe-loan", "clark", "miguel",
    ],
    name_keywords: ["debt", "loan", "student loan", "auto loan", "perritts", "tahoe", "clarks"],
  },

  // ---------- Variable / discretionary buckets ----------
  {
    key: "transportation",
    label: "Transportation (variable)",
    guideline_pct: 8,
    guideline_kind: "max",
    guideline_source: "Variable transportation (fuel, parking, rideshare, repairs) — typically ≤8% of take-home outside of car payments.",
    role: "variable",
    slug_matchers: ["gas", "fuel", "auto-", "car-", "uber", "lyft", "parking", "tolls", "transit", "vehicle"],
    name_keywords: ["gas", "fuel", "car/gas", "auto", "uber", "lyft", "parking", "tolls", "transit", "vehicle"],
  },
  {
    key: "groceries",
    label: "Groceries",
    guideline_pct: 12,
    guideline_kind: "max",
    guideline_source: "USDA/CFP food-at-home guideline: roughly 8–12% of take-home for a family.",
    role: "variable",
    slug_matchers: ["grocer", "groceries", "food-home", "supermarket"],
    name_keywords: ["grocery", "groceries", "supermarket"],
  },
  {
    key: "eating_out",
    label: "Eating Out",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "CFP discretionary food guideline: dining out ≤5% of take-home.",
    role: "variable",
    slug_matchers: [
      "eat-out", "eating-out", "eating", "j-eo", "k-eo", "j-eating", "k-eating",
      "-eo", "dining", "restaurant", "coffee", "dates", "date-", "takeout",
    ],
    name_keywords: ["eating out", "eo", "j-eo", "k-eo", "dining", "restaurant", "coffee", "dates", "takeout"],
  },
  {
    key: "personal",
    label: "Personal",
    guideline_pct: 10,
    guideline_kind: "max",
    guideline_source: "Personal & lifestyle (clothing, hobbies, self-care, miscellaneous) — typically ≤10% combined.",
    role: "variable",
    slug_matchers: [
      "misc", "j-misc", "k-misc", "random", "personal", "k-sc", "self-care",
      "selfcare", "clothing", "hobby", "haircut", "jp-haircut", "take5", "barber", "beauty",
    ],
    name_keywords: ["misc", "personal", "self-care", "self care", "clothing", "hobby", "haircut", "random", "barber"],
  },
  {
    key: "kids",
    label: "Kids",
    guideline_pct: 10,
    guideline_kind: "max",
    guideline_source: "Kids' direct expenses (activities, school, supplies) — varies widely; 5–10% is a common range.",
    role: "variable",
    slug_matchers: ["kid", "child", "school", "daycare", "activities", "diaper"],
    name_keywords: ["kids", "child", "school", "daycare", "diaper", "activities"],
  },
  {
    key: "pets",
    label: "Pets",
    guideline_pct: 2,
    guideline_kind: "max",
    guideline_source: "Routine pet costs (food, grooming, vet basics) — typically ≤2% of take-home.",
    role: "variable",
    slug_matchers: ["pet", "dog", "cat", "vet", "groomer", "dog-savings"],
    name_keywords: ["pet", "dog", "cat", "vet", "groomer"],
  },
  {
    key: "hosting",
    label: "Hosting",
    guideline_pct: 3,
    guideline_kind: "target",
    guideline_source: "Hospitality / community meals — a stewardship-informed line; typically 1–3% of take-home.",
    role: "variable",
    slug_matchers: ["host", "hosting", "hospitality", "tithe-misc", "community"],
    name_keywords: ["host", "hosting", "hospitality", "community meal"],
  },
  {
    key: "gifts",
    label: "Gifts",
    guideline_pct: 2,
    guideline_kind: "max",
    guideline_source: "Gift-giving (birthdays, Christmas, weddings) — typically ≤2% of take-home.",
    role: "variable",
    slug_matchers: ["gift", "present", "christmas", "birthday"],
    name_keywords: ["gift", "present", "christmas", "birthday"],
  },
  {
    key: "medical",
    label: "Medical",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "Out-of-pocket medical (copays, prescriptions, dental) — typically ≤5% of take-home.",
    role: "variable",
    slug_matchers: ["medical", "doctor", "dentist", "pharmacy", "rx", "health-oop"],
    name_keywords: ["medical", "doctor", "dentist", "pharmacy", "prescription"],
  },
  {
    key: "subscriptions",
    label: "Subscriptions",
    guideline_pct: 2,
    guideline_kind: "max",
    guideline_source: "Recurring digital subscriptions (streaming, software, memberships) — typically ≤2% of take-home.",
    role: "variable",
    slug_matchers: [
      "subscription", "streaming", "netflix", "spotify", "membership",
      "claude", "ymca", "nuuly",
    ],
    name_keywords: ["subscription", "streaming", "netflix", "spotify", "membership", "claude", "ymca", "nuuly"],
  },
  {
    key: "travel",
    label: "Travel",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "Travel & vacation — typically ≤5% of take-home, often saved into a sinking fund.",
    role: "variable",
    slug_matchers: ["travel", "vacation", "trip", "flight", "hotel", "airbnb"],
    name_keywords: ["travel", "vacation", "trip", "flight", "hotel", "airbnb"],
  },
];

export interface BucketAssignment {
  bucket_key: string | null; // null = unmatched (do NOT fall back to "other")
}

export function assignBucket(slug: string, name: string): BucketAssignment {
  const s = (slug || "").toLowerCase();
  const n = (name || "").toLowerCase();
  // Slug pass first — exact intent signals
  for (const b of CFP_BUCKETS) {
    if (b.slug_matchers.some(m => s.includes(m))) return { bucket_key: b.key };
  }
  // Name pass — display label fallback
  for (const b of CFP_BUCKETS) {
    if (b.name_keywords.some(k => n.includes(k))) return { bucket_key: b.key };
  }
  return { bucket_key: null };
}
