// Helpers for non-qualified (NQ) account intent designation.
// An NQ key (member profile_id or 'joint') is "unclassified" when the
// household has a non-zero NQ balance for that key but has not yet marked
// it as 'retirement' or 'other_goals' in non_retirement_intent.

export type NqIntent = 'retirement' | 'other_goals';

export interface NqIntentInputs {
  non_retirement_per_member?: Record<string, number | string> | null;
  non_retirement_intent?: Record<string, string> | null;
  monthly_additions_per_key?: Record<string, number | string> | null;
}

export function getUnclassifiedNqKeys(profile: NqIntentInputs | null | undefined): string[] {
  if (!profile) return [];
  const balances = (profile.non_retirement_per_member || {}) as Record<string, number | string>;
  const additions = (profile.monthly_additions_per_key || {}) as Record<string, number | string>;
  const intent = (profile.non_retirement_intent || {}) as Record<string, string>;
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(balances)) {
    if ((Number(v) || 0) > 0) keys.add(k);
  }
  // Also surface NQ keys with monthly contributions but no balance yet.
  for (const k of Object.keys(additions)) {
    const m = k.match(/^nq_(.+)_(retirement|nonret)$/);
    if (m && (Number(additions[k]) || 0) > 0) keys.add(m[1]);
  }
  return [...keys].filter(k => intent[k] !== 'retirement' && intent[k] !== 'other_goals');
}

export function hasUnclassifiedNq(profile: NqIntentInputs | null | undefined): boolean {
  return getUnclassifiedNqKeys(profile).length > 0;
}
