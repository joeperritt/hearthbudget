// CFP-style spending buckets used by the Spending Analyzer.
// Guideline percentages are rough anchors widely cited in CFP and stewardship
// literature. They are anchors for conversation, not hard rules.

export interface CfpBucket {
  key: string;
  label: string;
  guideline_pct: number;        // target % of monthly take-home
  guideline_kind: "max" | "min" | "target";
  guideline_source: string;     // shown in info tooltip in UI
  // Slug substrings (lowercased) that map a household category to this bucket.
  slug_matchers: string[];
  // Name keywords (lowercased) used as a fallback when slug doesn't match.
  name_keywords: string[];
}

export const CFP_BUCKETS: CfpBucket[] = [
  {
    key: "giving",
    label: "Giving",
    guideline_pct: 10,
    guideline_kind: "min",
    guideline_source: "Tithe / generosity baseline (10%) — common stewardship anchor.",
    slug_matchers: ["tithe", "giving", "generosity", "offering", "missions", "charity"],
    name_keywords: ["tithe", "giving", "generosity", "offering", "missions", "charity"],
  },
  {
    key: "saving",
    label: "Saving & Investing",
    guideline_pct: 15,
    guideline_kind: "min",
    guideline_source: "CFP retirement-readiness guideline of 10–15% of gross.",
    slug_matchers: ["savings", "save-", "invest", "retirement", "ira", "401k", "brokerage", "emergency"],
    name_keywords: ["savings", "investment", "retirement", "ira", "401k", "brokerage", "emergency fund"],
  },
  {
    key: "housing",
    label: "Housing (variable)",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "Variable housing costs (utilities, repairs, HOA) — typically ≤5% of take-home outside of mortgage/rent.",
    slug_matchers: ["util", "electric", "water", "gas-bill", "internet", "hoa", "home-repair", "home-maint", "lawn"],
    name_keywords: ["utilities", "electric", "water", "internet", "hoa", "lawn", "home repair", "home maintenance"],
  },
  {
    key: "transportation",
    label: "Transportation",
    guideline_pct: 15,
    guideline_kind: "max",
    guideline_source: "CFP guideline: total transportation ≤15% of take-home (incl. car payments, fuel, insurance, repairs).",
    slug_matchers: ["gas", "fuel", "auto", "car-", "uber", "lyft", "parking", "tolls", "transit", "vehicle"],
    name_keywords: ["gas", "fuel", "auto", "car ", "uber", "lyft", "parking", "tolls", "transit", "vehicle"],
  },
  {
    key: "groceries",
    label: "Groceries",
    guideline_pct: 12,
    guideline_kind: "max",
    guideline_source: "USDA/CFP food-at-home guideline: roughly 8–12% of take-home for a family.",
    slug_matchers: ["grocer", "groceries", "food-home", "supermarket"],
    name_keywords: ["grocery", "groceries", "supermarket"],
  },
  {
    key: "eating_out",
    label: "Eating Out",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "CFP discretionary food guideline: dining out ≤5% of take-home.",
    slug_matchers: ["eat-out", "eating-out", "j-eo", "k-eo", "dining", "restaurant", "coffee", "dates", "date-"],
    name_keywords: ["eating out", "dining", "restaurant", "coffee", "dates", "takeout"],
  },
  {
    key: "personal",
    label: "Personal",
    guideline_pct: 10,
    guideline_kind: "max",
    guideline_source: "Personal & lifestyle (clothing, hobbies, self-care, miscellaneous) — typically ≤10% combined.",
    slug_matchers: ["misc", "j-misc", "k-misc", "random", "personal", "k-sc", "self-care", "selfcare", "clothing", "hobby", "haircut"],
    name_keywords: ["misc", "personal", "self-care", "self care", "clothing", "hobby", "haircut", "random"],
  },
  {
    key: "kids",
    label: "Kids",
    guideline_pct: 10,
    guideline_kind: "max",
    guideline_source: "Kids' direct expenses (activities, school, supplies) — varies widely; 5–10% is a common range.",
    slug_matchers: ["kid", "child", "school", "daycare", "activities", "diaper"],
    name_keywords: ["kids", "child", "school", "daycare", "diaper", "activities"],
  },
  {
    key: "pets",
    label: "Pets",
    guideline_pct: 2,
    guideline_kind: "max",
    guideline_source: "Routine pet costs (food, grooming, vet basics) — typically ≤2% of take-home.",
    slug_matchers: ["pet", "dog", "cat", "vet"],
    name_keywords: ["pet", "dog", "cat", "vet"],
  },
  {
    key: "hosting",
    label: "Hosting",
    guideline_pct: 3,
    guideline_kind: "target",
    guideline_source: "Hospitality / community meals — a stewardship-informed line; typically 1–3% of take-home.",
    slug_matchers: ["host", "hosting", "hospitality", "tithe-misc", "community"],
    name_keywords: ["host", "hosting", "hospitality", "community meal"],
  },
  {
    key: "gifts",
    label: "Gifts",
    guideline_pct: 2,
    guideline_kind: "max",
    guideline_source: "Gift-giving (birthdays, Christmas, weddings) — typically ≤2% of take-home.",
    slug_matchers: ["gift", "present", "christmas", "birthday"],
    name_keywords: ["gift", "present", "christmas", "birthday"],
  },
  {
    key: "medical",
    label: "Medical",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "Out-of-pocket medical (copays, prescriptions, dental) — typically ≤5% of take-home.",
    slug_matchers: ["medical", "doctor", "dentist", "pharmacy", "rx", "health"],
    name_keywords: ["medical", "doctor", "dentist", "pharmacy", "prescription", "health"],
  },
  {
    key: "subscriptions",
    label: "Subscriptions",
    guideline_pct: 2,
    guideline_kind: "max",
    guideline_source: "Recurring digital subscriptions (streaming, software, memberships) — typically ≤2% of take-home.",
    slug_matchers: ["subscription", "streaming", "netflix", "spotify", "membership"],
    name_keywords: ["subscription", "streaming", "netflix", "spotify", "membership"],
  },
  {
    key: "travel",
    label: "Travel",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "Travel & vacation — typically ≤5% of take-home, often saved into a sinking fund.",
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
  for (const b of CFP_BUCKETS) {
    if (b.slug_matchers.some(m => s.includes(m))) return { bucket_key: b.key };
  }
  for (const b of CFP_BUCKETS) {
    if (b.name_keywords.some(k => n.includes(k))) return { bucket_key: b.key };
  }
  return { bucket_key: null };
}
