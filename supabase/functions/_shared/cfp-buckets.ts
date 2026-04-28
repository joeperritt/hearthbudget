// CFP-style spending buckets used by the Spending Analyzer.
// Guideline percentages are anchors widely cited in CFP and stewardship
// literature. They guide conversation, not hard rules.
//
// "role":
//   "variable" — buckets typically driven by user discretion month-to-month.
//                Categorized by AI from raw merchant data, with a per-household
//                merchant cache learning corrections over time.
//   "fixed"    — buckets typically paid via recurring bills (mortgage,
//                utilities, insurance, debt service, giving, saving). Sourced
//                from `fixed_expenses` and structural budget groups (savings,
//                giving). The AI never retunes these.

export interface CfpBucket {
  key: string;
  label: string;
  guideline_pct: number;        // target % of monthly take-home
  guideline_kind: "max" | "min" | "target";
  guideline_source: string;     // shown in info tooltip in UI
  role: "variable" | "fixed";
  // Plain-language hint used in the AI prompt so Gemini knows what kinds of
  // merchants belong here. Not used for any deterministic matching.
  ai_hint: string;
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
    ai_hint: "Tithe, church, charity, missions, religious giving, non-profit donations.",
  },
  {
    key: "saving",
    label: "Saving & Investing",
    guideline_pct: 15,
    guideline_kind: "min",
    guideline_source: "CFP retirement-readiness guideline of 10–15% of gross.",
    role: "fixed",
    ai_hint: "Transfers to savings accounts, retirement contributions (401k/IRA), brokerage deposits, sinking funds.",
  },
  {
    key: "housing",
    label: "Housing",
    guideline_pct: 28,
    guideline_kind: "max",
    guideline_source: "CFP guideline: total housing (mortgage/rent + taxes + insurance) ≤28% of take-home.",
    role: "fixed",
    ai_hint: "Mortgage, rent, HOA, property taxes, home repairs, lawn care, household maintenance.",
  },
  {
    key: "utilities",
    label: "Utilities",
    guideline_pct: 7,
    guideline_kind: "max",
    guideline_source: "Utilities (electric, water, gas, trash, internet, phone) — typically 5–7% of take-home.",
    role: "fixed",
    ai_hint: "Electric, water, gas, trash, internet, cell phone bills.",
  },
  {
    key: "insurance",
    label: "Insurance",
    guideline_pct: 10,
    guideline_kind: "max",
    guideline_source: "Combined insurance (health, life, disability, auto, home, pet) — typically ≤10% of take-home.",
    role: "fixed",
    ai_hint: "Health, life, disability, auto, home, renters, and pet insurance premiums.",
  },
  {
    key: "debt",
    label: "Debt Service",
    guideline_pct: 15,
    guideline_kind: "max",
    guideline_source: "Non-mortgage debt service (auto, student, credit card payoff) — CFP 36% rule less housing.",
    role: "fixed",
    ai_hint: "Student loan, auto loan, personal loan, credit card payoff payments (not credit card spending itself).",
  },

  // ---------- Variable / discretionary buckets ----------
  {
    key: "transportation",
    label: "Transportation",
    guideline_pct: 8,
    guideline_kind: "max",
    guideline_source: "Variable transportation (fuel, parking, rideshare, repairs) — typically ≤8% of take-home outside of car payments.",
    role: "variable",
    ai_hint: "Gas stations, parking, tolls, rideshare (Uber/Lyft), public transit, auto repair shops, oil change.",
  },
  {
    key: "groceries",
    label: "Groceries",
    guideline_pct: 12,
    guideline_kind: "max",
    guideline_source: "USDA/CFP food-at-home guideline: roughly 8–12% of take-home for a family.",
    role: "variable",
    ai_hint: "Supermarkets, grocery stores (Publix, Kroger, Aldi, Trader Joe's, Whole Foods, Walmart Grocery, Costco for food).",
  },
  {
    key: "eating_out",
    label: "Eating Out",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "CFP discretionary food guideline: dining out ≤5% of take-home.",
    role: "variable",
    ai_hint: "Restaurants, fast food, coffee shops (Starbucks, Chick-fil-A, Chipotle), takeout, delivery (DoorDash, Uber Eats), bars.",
  },
  {
    key: "personal",
    label: "Personal",
    guideline_pct: 10,
    guideline_kind: "max",
    guideline_source: "Personal & lifestyle (clothing, hobbies, self-care, miscellaneous) — typically ≤10% combined.",
    role: "variable",
    ai_hint: "Clothing, shoes, hair salon, barber, beauty, spa, hobbies, personal Amazon/Target purchases not otherwise categorized.",
  },
  {
    key: "kids",
    label: "Kids",
    guideline_pct: 10,
    guideline_kind: "max",
    guideline_source: "Kids' direct expenses (activities, school, supplies) — varies widely; 5–10% is a common range.",
    role: "variable",
    ai_hint: "Daycare, school tuition, kids' activities, sports, school supplies, diapers, kids' clothing, toy stores.",
  },
  {
    key: "pets",
    label: "Pets",
    guideline_pct: 2,
    guideline_kind: "max",
    guideline_source: "Routine pet costs (food, grooming, vet basics) — typically ≤2% of take-home.",
    role: "variable",
    ai_hint: "Pet food (Chewy, PetSmart), groomer, vet visits, pet supplies.",
  },
  {
    key: "hosting",
    label: "Hosting",
    guideline_pct: 3,
    guideline_kind: "target",
    guideline_source: "Hospitality / community meals — a stewardship-informed line; typically 1–3% of take-home.",
    role: "variable",
    ai_hint: "Hospitality, hosting community meals, party supplies for guests, church hospitality. Rare unless explicit.",
  },
  {
    key: "gifts",
    label: "Gifts",
    guideline_pct: 2,
    guideline_kind: "max",
    guideline_source: "Gift-giving (birthdays, Christmas, weddings) — typically ≤2% of take-home.",
    role: "variable",
    ai_hint: "Gift purchases, flowers (1-800-Flowers), wedding registries, birthday/Christmas/holiday gifts.",
  },
  {
    key: "medical",
    label: "Medical",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "Out-of-pocket medical (copays, prescriptions, dental) — typically ≤5% of take-home.",
    role: "variable",
    ai_hint: "Doctor copays, dentist, pharmacy (CVS, Walgreens), prescriptions, urgent care, optometrist.",
  },
  {
    key: "subscriptions",
    label: "Subscriptions",
    guideline_pct: 2,
    guideline_kind: "max",
    guideline_source: "Recurring digital subscriptions (streaming, software, memberships) — typically ≤2% of take-home.",
    role: "variable",
    ai_hint: "Streaming (Netflix, Spotify, Hulu, Disney+), software subscriptions (Claude, ChatGPT), gym memberships (YMCA), clothing rental (Nuuly).",
  },
  {
    key: "travel",
    label: "Travel",
    guideline_pct: 5,
    guideline_kind: "max",
    guideline_source: "Travel & vacation — typically ≤5% of take-home, often saved into a sinking fund.",
    role: "variable",
    ai_hint: "Airlines, hotels, Airbnb, VRBO, vacation rentals, cruise lines, travel booking sites.",
  },
];

export const VARIABLE_BUCKET_KEYS = CFP_BUCKETS.filter(b => b.role === "variable").map(b => b.key);
export const FIXED_BUCKET_KEYS = CFP_BUCKETS.filter(b => b.role === "fixed").map(b => b.key);

/**
 * Normalize a merchant name for caching: lowercase, strip non-alphanumerics,
 * collapse whitespace. Aim is to merge "AMAZON.COM*ABC123" / "Amazon Mktp"
 * variants into a single cache key. Caller is responsible for any extra
 * stripping (e.g. trailing transaction IDs).
 */
export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.toLowerCase();
  // Strip common Plaid suffixes / store ids
  s = s.replace(/\b(purchase|payment|debit|pos|tst\*|sq \*|sq\*|tst |pmnt|ach)\b/g, " ");
  s = s.replace(/\*[a-z0-9]{4,}/g, " "); // *ABC123 ids
  s = s.replace(/#\d+/g, " ");
  s = s.replace(/\b\d{4,}\b/g, " ");      // long numeric runs
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Family-of-merchant key — the first 1-2 meaningful tokens, used to detect
 * obvious cross-household merchants. Used only for grouping, never for AI
 * substitution.
 */
export function merchantFamilyKey(normalized: string): string {
  if (!normalized) return "";
  const parts = normalized.split(" ").filter(Boolean);
  return parts.slice(0, 2).join(" ");
}
