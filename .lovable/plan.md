

# Enrich Month Snapshots with Transfers and Per-Category Spending

## Summary

Two additions to the snapshot data saved during month transitions, applied consistently to both the auto-transition `useEffect` and the `startNewMonth` callback in `useBudgetData.ts`.

## Changes (single file: `src/hooks/useBudgetData.ts`)

### 1. Add `spentByCategory` to `transactions_summary`

Build a map of category slug → total spent from expense transactions only (filtering out income, deposit, cc-payment, transfer, and prior-month types). Add this as a `spentByCategory` field alongside the existing `totalTransactions`, `totalExpenses`, `totalSpent`.

```typescript
const EXCLUDED_TYPES = ['income', 'deposit', 'cc-payment', 'budget-adjustment'];
const EXCLUDED_PREFIXES = ['ignore-'];

const spentByCategory: Record<string, number> = {};
monthTxns
  .filter(t => t.transactionType === 'expense' && !t.categoryId.startsWith('ignore-'))
  .forEach(t => {
    spentByCategory[t.categoryId] = (spentByCategory[t.categoryId] || 0) + t.amount;
  });

const summary = {
  totalTransactions: monthTxns.length,
  totalExpenses: expenseTxns.length,
  totalSpent: expenseTxns.reduce((s, t) => s + t.amount, 0),
  spentByCategory,
};
```

### 2. Add `transfers` to the snapshot insert

Filter `transfers` state to only those matching the active month (by date prefix), then include as a `transfers` field in the `budget_month_snapshots` insert.

```typescript
const monthTransfers = transfers.filter(t => t.date.startsWith(activeMonth));

await supabase.from('budget_month_snapshots').insert({
  ...existing fields...,
  transfers: monthTransfers,
});
```

### 3. Database migration

Add a `transfers` JSONB column to `budget_month_snapshots` (the `transactions_summary` column is already JSONB so `spentByCategory` needs no schema change).

```sql
ALTER TABLE public.budget_month_snapshots
  ADD COLUMN transfers jsonb NOT NULL DEFAULT '[]'::jsonb;
```

### 4. Apply to both code paths

Both the auto-transition `useEffect` (lines 117-137) and `startNewMonth` (lines 271-298) get the identical `spentByCategory` computation and `transfers` field. Extract a shared helper function `buildSnapshotData` to avoid duplication.

### 5. Add `transfers` to dependency arrays

The auto-transition `useEffect` dependency array (line 139) needs `transfers` added.

