# Treat transfers and deposit add-backs as transactions

## What I found while diagnosing Bug 1 (the Dog math)

DB shows: Dog budgeted = $75. May transfers OUT of Dog = $657.70 (3 transfers). May transactions on Dog include a Wealthfront row with `amount = -$791, transaction_type = 'expense'` plus normal expenses summing to $208.30. So:

- `spentByCategory[dog]` = 10 + 15 + 183.30 + (-791) = **-$582.70**
- `transferAdjustments[dog]` = **-$657.70**
- `adjustedBudget = budgeted + transferAdj` = 75 - 657.70 = **-$582.70**
- Display: `-$582.70 of -$582.70` ✓ matches the screenshot

So both numbers are colliding at -$582.70 by coincidence. The real architectural problem: a $791 inflow is being modeled as a negative-amount expense on Dog (almost certainly a misapplied refund/deposit), and the transfer-out logic produces a confusing negative budget.

**Bug 1 needs a clarifying decision from you before I commit a fix** — see "Open question" below.

## Open question on Bug 1

Your stated expectation: "Dog should show **$75 of $75 spent, $0 remaining**." For that to be true mathematically, one of these models must be right:

**Model A — refund offsets transfer-out, transfers reduce budget**
- Budget = original − transfers out + deposit add-backs = 75 − 657.70 + 791 = **$208.30**
- Spent = gross expenses only = 10+15+183.30 = **$208.30**
- Displays "$208.30 of $208.30" — not $75/$75.

**Model B — transfers are just informational, original budget is the truth**
- Budget = 75 (ignore transfers in the per-bucket card)
- Spent = gross expenses + refunds net, *if refund is treated as deposit add-back instead* = $208.30 - $791 (treated as add-back) ... still not $75.

**Model C — the Wealthfront -$791 row is bad data and should be reclassified as a deposit, not an expense.** Then:
- spent = 10+15+183.30 = $208.30 (gross)
- adjustedBudget = 75 + transferAdj − depositAddBacks subtracted from spent already? With the refund logic on line 225-227 of `Index.tsx`, a deposit assigned to dog reduces `spentByCategory[dog]` by $791, giving spent = -$582.70. Same problem, different label.

**None of these naturally produce $75 of $75 unless that -$791 row is unrelated to Dog (data-entry error).**

**Please pick one:**
1. Recategorize/delete the -$791 Wealthfront row (it's the actual bug — data, not code) and the math will resolve.
2. I should change the model so transfer-out reduces the *spent* side instead of the *budget* side (so an over-refund + transfer-out shows as positive remaining instead of negative budget).
3. Other — describe how you want $75/$75 to fall out of these inputs.

While waiting on Bug 1, I will ship the other four items (which are unambiguous):

## What I will ship now

### Bug 2 — Transfers in Activity feed
Already implemented in `TransactionsView` (renders `transferRows` when `showTransfers` toggle is on; default true). I'll verify it actually renders, and if it's hidden behind an off-by-default state I'll flip the default and check the toggle UI.

### Bug 3 — Split deposit deducts instead of adds
Root cause in `EditTransactionSheet.tsx` lines 188-209 and `AddTransactionSheet.tsx` lines 102-115: split rows are always saved with `transaction_type: 'expense'` and a positive amount. When the original is a deposit, each split is then summed into `spentByCategory` as positive expense (line 219-220 of `Index.tsx`).

Fix: when the parent transaction (or the user's selected mode) is a deposit, write each split with `transaction_type: 'deposit'` so the existing line 225-227 logic subtracts from spent (= adds back to budget).

### Bug 4 — Ignored transactions in Activity unassigned list
`TransactionsView.tsx` line 186 filters `t.categoryId === 'unassigned'` only. Home uses the same check **plus** `!isExcluded(t)`. I'll add the same exclusion in the Activity filter.

### UI improvement — Transfer button on Categories tab
Add a prominent "Transfer Between Buckets" button near the top of `SpendingView`. Clicking opens `MoveFundsSheet` with an empty "From" picker (currently the sheet requires a from-id; I'll add a small "from picker" mode or a wrapper).

### Backlog item
The -$791 Wealthfront row as a probable data-entry / Plaid-mapping bug — I'll add to BACKLOG for you to audit.

## Files I'll touch

- `src/components/keeper/TransactionsView.tsx` — unassigned filter + verify transfer rendering
- `src/components/keeper/EditTransactionSheet.tsx` — preserve deposit type in splits
- `src/components/keeper/AddTransactionSheet.tsx` — same (if reachable for deposits)
- `src/components/keeper/SpendingView.tsx` — Transfer button
- `src/components/keeper/MoveFundsSheet.tsx` — allow opening without a preset `fromCategoryId`
- `src/pages/Index.tsx` — wire the new transfer entry point
- `BACKLOG.md` — Wealthfront -$791 audit note

After you answer the Bug 1 question, I'll add the math fix.
