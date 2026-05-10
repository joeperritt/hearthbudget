// Pure helper for credit-card cardholder attribution.
// Extracted from plaid-sync-helper.ts so it can be unit-tested.

export interface CardholderRule {
  slug: string;
  patterns: string[];
}

/**
 * Resolve a credit-card transaction to a cardholder slug.
 *
 * Rules:
 * - Search text is `account_owner` if present, otherwise transaction `name`,
 *   lowercased.
 * - The first holder whose pattern is a (case-insensitive) substring of the
 *   search text wins.
 * - If nothing matches, returns the fallback (typically the unassigned slug
 *   for the parent account).
 *
 * Order matters: rules are evaluated in array order. Callers should put the
 * most specific patterns first when ambiguity is possible.
 */
export function resolveCardholder(
  tx: { account_owner?: string | null; name?: string | null },
  rules: CardholderRule[],
  fallback: string,
): string {
  const owner = (tx.account_owner ?? "").toLowerCase();
  const txName = (tx.name ?? "").toLowerCase();
  const searchText = owner || txName;
  if (!searchText) return fallback;
  for (const holder of rules) {
    if (
      holder.patterns.some((p) => p && searchText.includes(p.toLowerCase()))
    ) {
      return holder.slug;
    }
  }
  return fallback;
}
