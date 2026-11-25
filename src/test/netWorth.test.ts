import { describe, it, expect } from 'vitest';
import { computeTotals, NwLineItem, scorecard, yearAgoIndex } from '@/lib/netWorth';

const li = (id: string, section: 'asset' | 'liability', category: string, flags: Partial<NwLineItem> = {}): NwLineItem =>
  ({ id, section, category, name: id, sort_order: 0, active: true, is_business_equity: false, is_business_loan: false, ...flags });

const items = [
  li('tod', 'asset', 'Taxable Accounts'), li('joint', 'asset', 'Taxable Accounts'),
  li('r401', 'asset', 'Tax-Advantaged Accounts'), li('k401', 'asset', 'Tax-Advantaged Accounts'), li('rira', 'asset', 'Tax-Advantaged Accounts'), li('kira', 'asset', 'Tax-Advantaged Accounts'),
  li('chk', 'asset', 'Cash'), li('sav', 'asset', 'Cash'), li('wf', 'asset', 'Cash'), li('home', 'asset', 'Cash'),
  li('house', 'asset', 'Real Estate'), li('bbf', 'asset', 'Business Assets', { is_business_equity: true }),
  li('jv', 'asset', 'Other Assets'), li('kv', 'asset', 'Other Assets'),
  li('mort', 'liability', 'Mortgages'), li('tahoe', 'liability', 'Other Liabilities'), li('gx', 'liability', 'Other Liabilities'),
  li('loan', 'liability', 'Other Liabilities', { is_business_loan: true }),
];
const nov = { tod: 5444, joint: 1663, r401: 47322, k401: 36168, rira: 6086, kira: 1607, chk: 1, sav: 1, wf: 27919, home: 3000, house: 653000, bbf: 1567300, jv: 45000, kv: 58000, mort: 481204, tahoe: 24692, gx: 42936, loan: 766000 };
const oct25 = { tod: 280, r401: 26422, k401: 19766, rira: 6323, kira: 1486, chk: 1, sav: 1, wf: 7609, house: 627646, jv: 50000, kv: 20000, mort: 488006, tahoe: 30483 };

describe('net worth totals', () => {
  it('Nov 2026 matches the balance sheet', () => {
    const t = computeTotals(items, nov);
    expect(t.assets).toBe(2452511);
    expect(t.liabilities).toBe(1314832);
    expect(t.netWorth).toBe(1137679);
    expect(t.categories['Cryptocurrency']).toBe(0);
  });
  it('net worth without Blackbridge removes the equity and adds back the BBF loan', () => {
    expect(computeTotals(items, nov).netWorthExBusiness).toBe(1137679 - 1567300 + 766000);
  });
  it('Oct 2025 net worth from the seed values', () => {
    expect(computeTotals(items, oct25).netWorth).toBe(241045);
  });
  it('compares the latest snapshot with the one about a year earlier', () => {
    expect(yearAgoIndex(['2025-10-01', '2026-04-01', '2026-07-01', '2026-11-01'])).toBe(0);
  });
});

describe('prior year scorecard', () => {
  it('counts 9 hit, 3 faded, 2 short of 14', () => {
    const r = [...Array(9).fill('hit'), ...Array(3).fill('faded'), ...Array(2).fill('short')];
    expect(scorecard(r)).toEqual({ hit: 9, faded: 3, short: 2, total: 14 });
  });
});

describe('income total', () => {
  it('2026 through November is 340,378.53', () => {
    const rows = [[1964.43,21338.17],[2114.94,21122.55],[1536.02,23597.96],[28.17,20745.99],[291.89,21748.17],[1400.09,22353.93],[1252.91,28002.54,500,8000],[1671.95,28485.34,500,8000],[1727.85,37207.06,500,8000],[1247.82,27892.37,500,8000],[904.87,31243.51,500,8000]];
    const total = rows.flat().reduce((a, b) => a + b, 0);
    expect(total.toFixed(2)).toBe('340378.53');
  });
});
