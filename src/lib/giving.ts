export const GIVING_TYPES = ['Church', 'Charity - Ministry', 'Charity - Other', 'Generosity - see notes'] as const;
export interface GivingEntry { id: string; gift_date: string; type: string; recipient: string; amount: number; notes: string | null;
  recurring_id?: string | null; recurring_month?: string | null; unassigned?: boolean; skipped?: boolean; split_from?: string | null }

export function givingTotals(entries: GivingEntry[], year: number) {
  const list = entries.filter(e => !e.skipped && e.gift_date.startsWith(`${year}-`));
  const byMonth: Record<string, number> = {}, byType: Record<string, number> = {}, byRecipient: Record<string, number> = {};
  let total = 0;
  for (const e of list) {
    const a = Math.round(Number(e.amount) * 100);
    total += a;
    const m = e.gift_date.slice(0, 7);
    byMonth[m] = (byMonth[m] ?? 0) + a;
    byType[e.type] = (byType[e.type] ?? 0) + a;
    const r = e.unassigned ? 'Unassigned' : e.recipient.trim() || '(No recipient)';
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
  for (const e of entries) { if (e.skipped) continue; const k = e.gift_date.slice(0, 7); m[k] = Math.round(((m[k] ?? 0) + Number(e.amount)) * 100) / 100; }
  return m;
}

export interface RecurringItem { id: string; recipient: string; type: string; amount: number; kind: 'fixed' | 'bucket'; start_month: string; end_month: string | null; sort_order: number; notes: string | null }

/** True when the item is active in 'YYYY-MM'. */
export const activeIn = (r: Pick<RecurringItem, 'start_month' | 'end_month'>, month: string) =>
  r.start_month.slice(0, 7) <= month && (!r.end_month || r.end_month.slice(0, 7) >= month);

/** Sum of fixed + bucket recurring items active in 'YYYY-MM', to the cent. */
export function recurringTotal(items: RecurringItem[], month: string) {
  return items.filter(r => activeIn(r, month)).reduce((t, r) => t + Math.round(Number(r.amount) * 100), 0) / 100;
}

/** Months 'YYYY-MM' a recurring item generates, from start through min(end, current). Never future months. */
export function generatedMonths(r: Pick<RecurringItem, 'start_month' | 'end_month'>, currentMonth: string) {
  const out: string[] = [];
  const last = r.end_month && r.end_month.slice(0, 7) < currentMonth ? r.end_month.slice(0, 7) : currentMonth;
  let [y, m] = r.start_month.slice(0, 7).split('-').map(Number);
  while (`${y}-${String(m).padStart(2, '0')}` <= last) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/** A bucket split is valid when every gift has a recipient and positive amount and the total is at most the bucket. */
export function splitError(bucket: number, gifts: { recipient: string; amount: number }[]) {
  if (!gifts.length) return 'Add at least one gift';
  if (gifts.some(g => !g.recipient.trim() || !(g.amount > 0))) return 'Each gift needs a recipient and amount';
  const t = gifts.reduce((a, g) => a + Math.round(g.amount * 100), 0);
  return t > Math.round(bucket * 100) ? 'Gifts add up to more than the bucket' : null;
}
