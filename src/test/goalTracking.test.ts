import { describe, expect, it } from 'vitest';
import { TrackedGoal, TrackingContext, goalProgress } from '@/lib/goalTracking';
import { givingTotals } from '@/lib/giving';

const base: TrackingContext = {
  today: '2027-06-15', habits: [], logs: [], givingByMonth: {}, advisor: [],
  latestLineItem: () => null, latestNetWorth: null, latestNetWorthEx: null,
};
const g = (p: Partial<TrackedGoal>): TrackedGoal => ({ horizon: '2027', tracking_type: 'linked', target: null, linked_metric: null, linked_line_item_id: null, habit_id: null, progress: {}, ...p });

describe('goal tracking', () => {
  it('giving is hit when any 2027 month reaches $6,000', () => {
    const goal = g({ linked_metric: 'giving_month', target: 6000 });
    expect(goalProgress(goal, { ...base, givingByMonth: { '2027-01': 5000, '2027-02': 5999.99 } })!.status).toBe('behind');
    const r = goalProgress(goal, { ...base, givingByMonth: { '2027-01': 5000, '2027-03': 6000, '2026-12': 9000 } })!;
    expect(r.status).toBe('hit');
    expect(r.detail).toBe('2027 total $11,000');
  });
  it('production is hit when any 2027 month reaches $30,000', () => {
    const goal = g({ linked_metric: 'production_month', target: 30000 });
    const adv = (p: number) => [{ month: '2027-02-01', aum: null, nna: null, production: p }];
    expect(goalProgress(goal, { ...base, advisor: adv(29999) })!.status).toBe('behind');
    expect(goalProgress(goal, { ...base, advisor: adv(30000) })!.status).toBe('hit');
  });
  it('emergency fund reads the latest line item value', () => {
    const goal = g({ linked_metric: 'nw_line_item', linked_line_item_id: 'wf', target: 40000 });
    expect(goalProgress(goal, { ...base, latestLineItem: () => 27919 })!.status).toBe('behind');
    expect(goalProgress(goal, { ...base, latestLineItem: () => 40000 })!.status).toBe('hit');
  });
  it('land goal manual done override', () => {
    const goal = g({ linked_metric: 'nw_line_item', linked_line_item_id: 'tod', target: 50000, progress: { done: true } });
    expect(goalProgress(goal, { ...base, latestLineItem: () => 5444 })!.status).toBe('hit');
  });
  it('NNA is the 2027 year-to-date sum', () => {
    const goal = g({ linked_metric: 'advisor_nna_ytd', target: 12000000 });
    const advisor = [
      { month: '2026-12-01', aum: null, nna: 9000000, production: null },
      { month: '2027-01-01', aum: null, nna: 7000000, production: null },
      { month: '2027-02-01', aum: null, nna: 5000000, production: null },
    ];
    expect(goalProgress(goal, { ...base, advisor })!.status).toBe('hit');
  });
  it('count, checklist and quarterly', () => {
    expect(goalProgress(g({ tracking_type: 'count', target: 4, progress: { count: 1 } }), base)!.label).toBe('1 of 4');
    expect(goalProgress(g({ tracking_type: 'checklist', progress: { done: true } }), base)!.status).toBe('hit');
    expect(goalProgress(g({ tracking_type: 'quarterly', progress: { q: [false, true] } }), base)!.status).toBe('behind');
    expect(goalProgress(g({ tracking_type: 'quarterly', progress: { q: [true] } }), base)!.status).toBe('on_track');
  });
  it('monthly is behind when a finished month was missed', () => {
    const ctx = { ...base, logs: [{ habit_id: 'd', log_date: '2027-01-10', value: 1 }, { habit_id: 'd', log_date: '2027-03-10', value: 1 }] };
    expect(goalProgress(g({ tracking_type: 'monthly', habit_id: 'd' }), ctx)!.status).toBe('behind');
  });
});

describe('giving totals', () => {
  it('adds to the cent by type and recipient', () => {
    const e = (d: string, type: string, recipient: string, amount: number) => ({ id: d + recipient, gift_date: d, type, recipient, amount, notes: null });
    const t = givingTotals([e('2026-01-05', 'Church', 'A', 0.1), e('2026-01-06', 'Church', 'A', 0.2), e('2026-02-01', 'Charity - Ministry', 'B', 1), e('2025-12-01', 'Church', 'A', 5)], 2026);
    expect(t.total).toBe(1.3);
    expect(t.byType.Church).toBe(0.3);
    expect(t.recipients[0]).toEqual(['B', 1]);
  });
});
