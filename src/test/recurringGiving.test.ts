import { describe, expect, it } from 'vitest';
import { RecurringItem, activeIn, generatedMonths, givingTotals, recurringTotal, splitError } from '@/lib/giving';
import { TrackingContext, goalProgress } from '@/lib/goalTracking';

const item = (p: Partial<RecurringItem>): RecurringItem => ({ id: 'x', recipient: 'R', type: 'Church', amount: 100, kind: 'fixed', start_month: '2026-12-01', end_month: null, sort_order: 0, notes: null, ...p });
const seed = [1800, 1000, 500, 300, 400, 500, 500].map((amount, i) => item({ id: String(i), amount, kind: i > 4 ? 'bucket' : 'fixed' }));

describe('recurring giving', () => {
  it('seed totals $5,000 a month from Dec 2026', () => {
    expect(recurringTotal(seed, '2026-12')).toBe(5000);
    expect(recurringTotal(seed, '2026-11')).toBe(0);
  });
  it('generates each month once, through the current month only', () => {
    expect(generatedMonths(item({}), '2027-02')).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(generatedMonths(item({ start_month: '2027-05-01' }), '2027-02')).toEqual([]);
  });
  it('stops at end_month', () => {
    expect(generatedMonths(item({ end_month: '2027-01-01' }), '2027-06')).toEqual(['2026-12', '2027-01']);
  });
  it('effective-from change keeps past months at the old amount', () => {
    const items = [item({ id: 'a', amount: 1800, end_month: '2027-02-01' }), item({ id: 'b', amount: 2200, start_month: '2027-03-01' })];
    expect(recurringTotal(items, '2027-02')).toBe(1800);
    expect(recurringTotal(items, '2027-03')).toBe(2200);
    expect(activeIn(items[0], '2027-03')).toBe(false);
  });
  it('bucket split must not exceed the bucket', () => {
    expect(splitError(500, [{ recipient: 'A', amount: 300 }, { recipient: 'B', amount: 200 }])).toBeNull();
    expect(splitError(500, [{ recipient: 'A', amount: 300 }])).toBeNull();
    expect(splitError(500, [{ recipient: 'A', amount: 300 }, { recipient: 'B', amount: 200.01 }])).not.toBeNull();
  });
  it('skipped months do not count in totals', () => {
    const t = givingTotals([
      { id: '1', gift_date: '2026-12-01', type: 'Church', recipient: 'Radius', amount: 1800, notes: null },
      { id: '2', gift_date: '2026-12-01', type: 'Church', recipient: 'Daybreak', amount: 300, notes: null, skipped: true },
    ], 2026);
    expect(t.total).toBe(1800);
  });
});

describe('2027 ongoing giving goal', () => {
  const ctx = (recurring: RecurringItem[], givingByMonth: Record<string, number> = {}): TrackingContext => ({
    today: '2027-06-15', habits: [], logs: [], givingByMonth, advisor: [], recurring,
    latestLineItem: () => null, latestNetWorth: null, latestNetWorthEx: null,
  });
  const goal = { horizon: '2027', tracking_type: 'linked' as const, target: 6000, linked_metric: 'giving_recurring_month' as const, linked_line_item_id: null, habit_id: null, progress: {} };
  it('a one-off big month does not hit it', () => {
    const r = goalProgress(goal, ctx(seed, { '2027-03': 20000 }))!;
    expect(r.status).toBe('behind');
    expect(r.detail).toBe('2027 total given $20,000');
  });
  it('hit when recurring total reaches $6,000 in a 2027 month', () => {
    expect(goalProgress(goal, ctx([...seed, item({ id: 'n', amount: 1000, start_month: '2027-04-01' })]))!.status).toBe('hit');
  });
});
