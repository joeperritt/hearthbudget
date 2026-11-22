import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { writeSnapshot } from '@/lib/snapshot';
import { needsAssignment, creditCardIds } from '@/lib/needsAssignment';

const JOE = '13efdfc1-d276-4a93-b4ff-9f238d5f4793';
const HH = '6c4e60db-1b94-41a1-935c-91d851966a50';
const db: Record<string, unknown[]> = { transactions: [] };

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: JOE }, profile: { household_id: HH } }) }));
vi.mock('@/integrations/supabase/client', () => {
  const query = (table: string) => {
    let single = false;
    const result = () => table === 'households'
      ? { data: { id: HH, active_month: '2026-11', planning_data: {} }, error: null }
      : { data: single ? (db[table] ?? [])[0] ?? null : db[table] ?? [], error: null };
    const chain: any = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result()).then(res, rej);
        if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return chain; };
        return () => chain;
      },
    });
    return chain;
  };
  const channel: any = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: query, channel: () => channel, removeChannel: () => {}, rpc: async () => ({ data: null, error: null }) } };
});

import { useBudgetData } from '@/hooks/useBudgetData';

const row = (o: Record<string, unknown>) => ({ notes: '', is_transfer_to_savings: false, entered_by: null, plaid_transaction_id: 'p', original_description: null, budget_month: '2026-11', ...o });
const cards = creditCardIds([{ id: 'joe-amex', type: 'credit_card' }]);

describe('a refund synced after the snapshot was saved', () => {
  beforeEach(() => localStorage.clear());

  it('appears in Unassigned and the count after the open refresh and after a return to the app', async () => {
    // 1. Snapshot saved yesterday: nothing to assign.
    writeSnapshot(JOE, 'budget', { householdId: HH, activeMonth: '2026-11', planningData: {}, categories: [], fixedExpenses: [], transfers: [], overrides: {}, transactions: [] });
    // 2. The overnight bank sync inserts Nike -211.86.
    db.transactions = [row({ id: 'nike', date: '2026-11-20', description: 'Nike', amount: -211.86, account: 'joe-amex', transaction_type: 'deposit', category_slug: 'unassigned' })];
    // 3. App opens: snapshot first, then the background refresh.
    const { result } = renderHook(() => useBudgetData());
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.transactions.filter(t => needsAssignment(t, cards)).map(t => t.id)).toEqual(['nike']));

    // 4. Another credit arrives while the app is in the background; returning refreshes.
    db.transactions = [...db.transactions, row({ id: 'fedex', date: '2026-11-21', description: 'FedEx', amount: -1, account: 'joe-amex', transaction_type: 'deposit', category_slug: 'unassigned' })];
    await act(async () => { window.dispatchEvent(new Event('perritt-resume')); });
    await waitFor(() => expect(result.current.transactions.filter(t => needsAssignment(t, cards)).length).toBe(2));
  });
});
