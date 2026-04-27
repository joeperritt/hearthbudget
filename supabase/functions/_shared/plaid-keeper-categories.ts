/**
 * Maps Plaid Personal Finance Category (PFC) primary buckets to a Keeper
 * category "intent" key. The intent key is then resolved to an actual
 * household category slug by the analyzer using fuzzy name matching against
 * the household's existing budget_categories + fixed_expenses.
 *
 * We deliberately keep this layer abstract — Joe & Katie's slugs (J-EO,
 * K-Misc, Hosting/Gifts/Random) are not what other households will use.
 * The intent vocabulary lets us reason about Plaid data without hardcoding
 * one household's structure.
 */

export type KeeperIntent =
  | "groceries"
  | "food_out"
  | "transportation"
  | "fuel"
  | "housing"
  | "utilities"
  | "internet_phone"
  | "insurance"
  | "medical"
  | "personal_care"
  | "entertainment"
  | "shopping"
  | "kids"
  | "pets"
  | "gifts"
  | "giving"
  | "subscriptions"
  | "travel"
  | "fees_interest"
  | "professional_services"
  | "general";

/**
 * Plaid PFC primary categories (as of 2024 taxonomy).
 * https://plaid.com/docs/api/products/transactions/#categoriesget
 */
export function plaidPrimaryToIntent(primary: string | null | undefined): KeeperIntent {
  if (!primary) return "general";
  const p = primary.toUpperCase();
  switch (p) {
    case "FOOD_AND_DRINK":
      return "food_out"; // groceries vs restaurants needs detailed bucket; default to food_out
    case "GENERAL_MERCHANDISE":
      return "shopping";
    case "TRANSPORTATION":
      return "transportation";
    case "TRAVEL":
      return "travel";
    case "RENT_AND_UTILITIES":
      return "utilities";
    case "HOME_IMPROVEMENT":
      return "housing";
    case "MEDICAL":
      return "medical";
    case "PERSONAL_CARE":
      return "personal_care";
    case "ENTERTAINMENT":
      return "entertainment";
    case "GENERAL_SERVICES":
      return "professional_services";
    case "GOVERNMENT_AND_NON_PROFIT":
      return "giving";
    case "BANK_FEES":
    case "LOAN_PAYMENTS":
      return "fees_interest";
    default:
      return "general";
  }
}

/**
 * Plaid PFC detailed categories — refines primary when we can. Returns null
 * to fall back to the primary mapping.
 */
export function plaidDetailedToIntent(detailed: string | null | undefined): KeeperIntent | null {
  if (!detailed) return null;
  const d = detailed.toUpperCase();

  if (d.includes("GROCERIES")) return "groceries";
  if (d.includes("RESTAURANT") || d.includes("FAST_FOOD") || d.includes("COFFEE")) return "food_out";
  if (d.includes("GAS")) return "fuel";
  if (d.includes("PUBLIC_TRANSIT") || d.includes("TAXIS_AND_RIDE_SHARES") || d.includes("PARKING")) return "transportation";
  if (d.includes("INTERNET_AND_CABLE") || d.includes("TELEPHONE")) return "internet_phone";
  if (d.includes("INSURANCE")) return "insurance";
  if (d.includes("RENT") || d.includes("MORTGAGE")) return "housing";
  if (d.includes("CHILD") || d.includes("DAYCARE")) return "kids";
  if (d.includes("PETS") || d.includes("VETERINARY")) return "pets";
  if (d.includes("DONATIONS") || d.includes("CHARITY") || d.includes("RELIGIOUS")) return "giving";
  if (d.includes("SUBSCRIPTION") || d.includes("STREAMING")) return "subscriptions";
  if (d.includes("GIFT")) return "gifts";

  return null;
}

/**
 * Plain-language label for an intent — used in AI prompts so commentary
 * reads naturally regardless of the household's slug naming.
 */
export const INTENT_LABEL: Record<KeeperIntent, string> = {
  groceries: "groceries",
  food_out: "eating out",
  transportation: "transportation",
  fuel: "fuel",
  housing: "housing",
  utilities: "utilities",
  internet_phone: "internet & phone",
  insurance: "insurance",
  medical: "medical",
  personal_care: "personal care",
  entertainment: "entertainment",
  shopping: "shopping",
  kids: "kids",
  pets: "pets",
  gifts: "gifts",
  giving: "giving",
  subscriptions: "subscriptions",
  travel: "travel",
  fees_interest: "fees & interest",
  professional_services: "professional services",
  general: "general spending",
};

/**
 * Normalize a category name for fuzzy matching. Lowercase, strip punctuation,
 * keep alphanumeric and spaces.
 */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Given an intent and the household's category names, pick the best matching
 * slug. Returns null if no reasonable match exists (caller should leave the
 * spending in "other").
 */
export function matchIntentToSlug(
  intent: KeeperIntent,
  candidates: { id: string; name: string }[]
): string | null {
  // Direct keyword hints per intent — checked against normalized names
  const hints: Record<KeeperIntent, string[]> = {
    groceries: ["groc", "food"],
    food_out: ["eat", "restaurant", "dining", "dates", "eo"],
    transportation: ["car", "gas", "transport", "uber", "lyft"],
    fuel: ["gas", "fuel", "car"],
    housing: ["mortgage", "rent", "house", "home"],
    utilities: ["util", "power", "water", "electric", "dominion"],
    internet_phone: ["internet", "phone", "spectrum", "cell"],
    insurance: ["insurance", "ltd", "pets best"],
    medical: ["medical", "health", "doctor"],
    personal_care: ["selfcare", "self care", "sc", "haircut", "beauty"],
    entertainment: ["entertain", "fun", "spotify", "claude"],
    shopping: ["misc", "random", "shopping"],
    kids: ["kid", "child"],
    pets: ["dog", "pet", "groomer"],
    gifts: ["gift"],
    giving: ["tithe", "giving", "church", "ccc", "radius", "od", "ef", "hosting"],
    subscriptions: ["subscript", "spotify", "claude", "nuuly", "ymca"],
    travel: ["travel", "vacation", "trip"],
    fees_interest: ["fee", "interest"],
    professional_services: ["service"],
    general: ["misc", "random"],
  };

  const wanted = hints[intent] || [];
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    const n = normalizeName(c.name);
    let score = 0;
    for (const w of wanted) {
      if (n === w) score += 5;
      else if (n.startsWith(w)) score += 3;
      else if (n.includes(w)) score += 2;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { id: c.id, score };
    }
  }
  return best?.id ?? null;
}
