export const ASSET_CATEGORIES = ['Taxable Accounts', 'Tax-Advantaged Accounts', 'Cryptocurrency', 'Cash', 'Real Estate', 'Business Assets', 'Other Assets'] as const;
export const LIABILITY_CATEGORIES = ['Mortgages', 'Other Liabilities'] as const;

export interface NwLineItem {
  id: string; section: 'asset' | 'liability'; category: string; name: string;
  sort_order: number; active: boolean; is_business_equity: boolean; is_business_loan: boolean;
}
/** values: line_item_id -> amount for one snapshot */
export type SnapshotValues = Record<string, number>;

export interface NetWorthTotals {
  categories: Record<string, number>;
  assets: number; liabilities: number; netWorth: number; netWorthExBusiness: number;
}

export function computeTotals(items: NwLineItem[], values: SnapshotValues): NetWorthTotals {
  const categories: Record<string, number> = {};
  for (const c of [...ASSET_CATEGORIES, ...LIABILITY_CATEGORIES]) categories[c] = 0;
  let assets = 0, liabilities = 0, equity = 0, loan = 0;
  for (const li of items) {
    const v = Number(values[li.id] ?? 0);
    categories[li.category] = (categories[li.category] ?? 0) + v;
    if (li.section === 'asset') assets += v; else liabilities += v;
    if (li.is_business_equity) equity += v;
    if (li.is_business_loan) loan += v;
  }
  const netWorth = assets - liabilities;
  return { categories, assets, liabilities, netWorth, netWorthExBusiness: netWorth - equity + loan };
}

/** Pick the snapshot closest to 12 months before the latest (excluding the latest). */
export function yearAgoIndex(months: string[]): number | null {
  if (months.length < 2) return null;
  const sorted = months.map((m, i) => ({ m, i })).sort((a, b) => a.m.localeCompare(b.m));
  const latest = sorted[sorted.length - 1];
  const [ly, lm] = latest.m.split('-').map(Number);
  const target = ly * 12 + lm - 12;
  let best: { i: number; d: number } | null = null;
  for (const s of sorted.slice(0, -1)) {
    const [y, m] = s.m.split('-').map(Number);
    const d = Math.abs(y * 12 + m - target);
    if (!best || d < best.d) best = { i: s.i, d };
  }
  return best ? best.i : null;
}

export function scorecard(results: (string | null)[]) {
  const c = { hit: 0, faded: 0, short: 0, total: results.length };
  for (const r of results) if (r === 'hit' || r === 'faded' || r === 'short') c[r]++;
  return c;
}

export const fmtWhole = (n: number) => {
  const s = Math.round(Math.abs(n)).toLocaleString('en-US');
  return n < -0.5 ? `(${s})` : s;
};
export const fmtCents = (n: number) =>
  (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
