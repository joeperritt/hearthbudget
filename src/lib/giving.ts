export const GIVING_TYPES = ['Church', 'Charity - Ministry', 'Charity - Other', 'Generosity - see notes'] as const;
export interface GivingEntry { id: string; gift_date: string; type: string; recipient: string; amount: number; notes: string | null }

export function givingTotals(entries: GivingEntry[], year: number) {
  const list = entries.filter(e => e.gift_date.startsWith(`${year}-`));
  const byMonth: Record<string, number> = {}, byType: Record<string, number> = {}, byRecipient: Record<string, number> = {};
  let total = 0;
  for (const e of list) {
    const a = Math.round(Number(e.amount) * 100);
    total += a;
    const m = e.gift_date.slice(0, 7);
    byMonth[m] = (byMonth[m] ?? 0) + a;
    byType[e.type] = (byType[e.type] ?? 0) + a;
    const r = e.recipient.trim() || '(No recipient)';
    byRecipient[r] = (byRecipient[r] ?? 0) + a;
  }
  const c = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / 100]));
  return {
    list, total: total / 100, byMonth: c(byMonth), byType: c(byType),
    recipients: Object.entries(c(byRecipient)).sort((a, b) => b[1] - a[1]),
  };
}

/** 'YYYY-MM' -> total across all years, for linked goals. */
export function givingByMonth(entries: GivingEntry[]) {
  const m: Record<string, number> = {};
  for (const e of entries) { const k = e.gift_date.slice(0, 7); m[k] = Math.round(((m[k] ?? 0) + Number(e.amount)) * 100) / 100; }
  return m;
}
