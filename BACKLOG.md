# Keeper Backlog

**Private family app for Joe and Katie only. Not a public product.**

Running list of things to get to, known limitations, and stuff to remember about this project. When working with Lovable, you can point it at this file: "check BACKLOG.md."

Last updated: April 27, 2026

**Successfully published April 27, 2026** — UX simplification (3-button transaction type system, refund preview math, standardized split rows, clickable fund transfers with delete, Plaid auto-detect disabled) shipped to keeperbudget.com.

## Feature backlog

### Floating "Ask Keeper" AI button

Global floating action button, persistent across all screens. Opens chat panel with context-aware prompt (current screen + user's household data).

- Use cases: app help ("how do I record a manual expense?"), category setup guidance, spending pattern recs, budgeting best practices, general financial questions
- Respects Stewardship Mode toggle
- Powered by Gemini 2.5 Flash (same as existing AI Insights) with CFP/CKA system prompt
- Consider rate limiting per household to control API costs
- Consider conversation history per user so follow-ups work

### Edit budget transfers in-place

Currently fund transfers can be viewed and deleted from the category detail modal, but editing requires delete + recreate. Add inline edit (amount, date, from/to). Low priority.

### Net worth tracking

Combines with Plaid Investments + Liabilities (below) for full financial picture.

### Plaid Investments product

Link retirement/brokerage accounts.

### Plaid Liabilities product

Link mortgage, student loans.

## Polish / quick fixes

- Unassigned transactions on Home desktop — apply Activity-tab-style single-row formatting
- Home tab: add Savings + Giving sections (desktop only, pill-style like Fixed)

### Done — April 27, 2026

- **Transaction-type system simplified to 3 buttons (Variable / Fixed / Ignore):** Collapsed the previous 5-button Add/Edit sheets (Variable, Fixed, Deposit, CC Pmt, Ignore + sub-selectors) into a single 3-button system. New `ignore-user` slug introduced for user-initiated ignores. Refunds/reimbursements handled by selecting Variable + a category and letting the signed-sum reduce spending. Notes field is surfaced prominently on Ignore so user can leave context (e.g. "cash withdrawal", "tax refund").
- **Slug rename `cc-payment` → `ignore-cc-payment`:** For naming consistency with the rest of the `ignore-*` family. Updated `CC_PAYMENT_CATEGORY` constant in `src/types/budget.ts` and all 18 historical rows carrying the old slug.
- **Activity row mute treatment:** Removed standalone "Transfer" and "CC Payment" pill badges. Ignored rows (transfer / cc-payment / income / deposit / prior-month / user-ignore) now render with `opacity-60` and muted text across the entire row (description, amount, account chip) as a single deemphasized visual unit. The muted styling is the signal — no auxiliary label needed.
- **Refund preview fix:** `CategoryBudgetMini` now accepts a *signed* `pendingAmount`. Negative values (refunds/deposits) animate the progress bar **backward**, render the projected-remaining label in green, and add a "Refunded $X back to budget" hint. EditTransactionSheet passes `transaction.amount` (signed) instead of `Math.abs(...)`.
- **Inflow amount styling restored:** `getTransactionAmountPresentation` now greens any negative-stored amount (checking credits and credit-card refunds) with a `+` prefix regardless of categorization, so refunds and deposits sitting in Unassigned are visually obvious. Outflows remain neutral; CC-payment rows from checking remain destructive.
- **Plaid auto-detect for transfers and CC payments DISABLED (user request):** Per Joe's product decision, all Plaid-synced transactions now land in `category_slug='unassigned'` for explicit manual review. The personal_finance_category TRANSFER_OUT/TRANSFER_IN routing, the description regex (ONLINE TRANSFER / WAY2SAVE / etc.), and the Wells Fargo Active Cash CC-payment regex were all stripped from `plaid-sync-helper.ts`. CC refunds (negative amount on a credit card) still get `transaction_type='deposit'` so totals stay correct, but stay in Unassigned. The 26 already-ignored historical rows (8 `ignore-transfer` + 18 `ignore-cc-payment`) were left untouched. Manual Ignore flow (`ignore-user` slug) is preserved exactly as built. Constants `TRANSFER_CATEGORY` and `CC_PAYMENT_CATEGORY` are kept in `src/types/budget.ts` for future re-enablement.

### Deferred / user-disabled

- **Auto-detect Plaid transfers and CC payments:** Originally shipped April 26 (transfer detection via `personal_finance_category` + description regex; Wells Fargo Active Cash CC-payment routing). Disabled April 27 at user request because Joe wants full visibility — every Plaid row should land in Unassigned for explicit review and one-by-one manual Ignore. Could be re-enabled in the future via a user setting in Account/Connection preferences. Slug constants and muted UI treatment are still wired so a re-enable would only require restoring the routing logic in `plaid-sync-helper.ts`.

### Done — April 26, 2026

- **Transfer detection and handling:** Plaid-synced bank transfers now auto-detected via `personal_finance_category` (with description-regex fallback) and excluded from Unassigned + budget calculations. Wells Fargo Active Cash card payments routed to `ignore-cc-payment` (renamed from `cc-payment` April 27); Way2Save inter-account transfers routed to `ignore-transfer`. Manual Transfer category remains available as fallback in the Edit/Add transaction sheet (under Ignore mode). Transfers and CC payments remain visible in Activity tab as muted rows. Backfill flipped 11 historical Plaid rows in the Perritt household (8 transfer, 3 cc-payment).
- **Manual duplicate cleanup needed (post-launch, low priority):** During the transfer fix, identified ~7 sibling duplicate rows from prior manual transfer-cleanup attempts. They sit in `ignore-*` buckets (financially neutral) but create accounting noise. Clean up manually in Activity tab when convenient — do NOT script cleanup due to risk of deleting wrong row of sibling pairs.

## Post-launch UX polish

- Empty states polish
- Loading skeletons
- Dark mode
- Reconciliation flag for potential manual/synced duplicate detection

## Data audit

### Wealthfront -$791 row on Dog category (May 2026)

Identified during the May 2026 Dog-category math investigation. Transaction is stored as `transaction_type='expense'` with `amount=-791` on the `dog` slug, which currently nets `spentByCategory[dog]` down to **-$582.70**. This is almost certainly a misclassified inflow (Plaid sync of a Wealthfront deposit, or a manual entry that should be a deposit/transfer). Combined with $657.70 of legitimate transfers out of Dog this month, the per-bucket card displays `-$582.70 of -$582.70`. Action: open the row in Activity → reclassify it (likely Ignore → auto-deposit, or split it across buckets as a deposit add-back) so Dog's math resolves naturally. Code-side accounting is correct given the input data.
