// Default starter budget seeded into every new household.
// Variable categories, fixed bills, savings buckets, giving items.

export const DEFAULT_CATEGORIES = [
  // Variable — Shared
  { slug: "groceries", name: "Groceries", budgeted: 700, group: "shared", sort_order: 0 },
  { slug: "car-gas", name: "Car/Gas", budgeted: 300, group: "shared", sort_order: 1 },
  { slug: "household", name: "Household", budgeted: 100, group: "shared", sort_order: 2 },
  { slug: "kids", name: "Kids", budgeted: 200, group: "shared", sort_order: 3 },
  { slug: "dates", name: "Dates", budgeted: 200, group: "shared", sort_order: 4 },
  { slug: "gifts", name: "Gifts", budgeted: 75, group: "shared", sort_order: 5 },
  { slug: "random", name: "Random", budgeted: 100, group: "shared", sort_order: 6 },
];

export const DEFAULT_FIXED_EXPENSES = [
  // Bills
  { slug: "mortgage", name: "Mortgage/Rent", amount: 0, group: "bills", sort_order: 0 },
  { slug: "electric", name: "Electric", amount: 150, group: "bills", sort_order: 1 },
  { slug: "water", name: "Water", amount: 75, group: "bills", sort_order: 2 },
  { slug: "internet", name: "Internet", amount: 80, group: "bills", sort_order: 3 },
  { slug: "phone", name: "Phone", amount: 100, group: "bills", sort_order: 4 },
  { slug: "trash", name: "Trash", amount: 30, group: "bills", sort_order: 5 },
  // Savings
  { slug: "emergency-fund", name: "Emergency Fund", amount: 500, group: "savings", sort_order: 0 },
  { slug: "retirement", name: "Retirement", amount: 500, group: "savings", sort_order: 1 },
  { slug: "vacation", name: "Vacation", amount: 200, group: "savings", sort_order: 2 },
  // Tithe / Giving
  { slug: "tithe", name: "Tithe", amount: 0, group: "tithe", sort_order: 0 },
];

export async function seedHouseholdDefaults(adminClient: any, householdId: string) {
  const cats = DEFAULT_CATEGORIES.map((c) => ({ ...c, household_id: householdId }));
  const exps = DEFAULT_FIXED_EXPENSES.map((e) => ({ ...e, household_id: householdId }));
  await adminClient.from("budget_categories").insert(cats);
  await adminClient.from("fixed_expenses").insert(exps);
}
