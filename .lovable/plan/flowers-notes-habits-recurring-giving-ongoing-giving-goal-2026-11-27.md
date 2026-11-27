# Flowers/notes habits, recurring giving, ongoing giving goal

All changes are additive. Existing giving_entries rows are never updated or deleted by any code or migration in this plan.

## 1) Two new monthly habits for Joe
- Data insert (no schema change): two habit_definitions rows for Joe (user 13efdfc1…), section occasional, kind yes_no, period month, target 1, start today, sort after "Something with Logan and Lily": "Flowers for Katie", "Written note for Katie".
- Two retreat_goals rows (retreat_year 2026, horizon "2027", category Family): "Buy flowers for Katie once a month" and "Write Katie a note once a month", tracking_type monthly, habit_id linked, target 1 (12 month dots via existing monthly tracker).
- No code change: Daily Goals and goal trackers are already data-driven.

## 2) Recurring giving
New table giving_recurring:
- household_id, recipient, type (same 4 giving types, CHECK), amount numeric(12,2) > 0, kind ('fixed' | 'bucket'), start_month date (first of month, CHECK day = 1), end_month date null (first of month, >= start_month), sort_order, notes, created_at/updated_at.
- Same household RLS as giving_entries (4 policies, household_id = get_household_id()), GRANTs to authenticated + service_role, no anon; household_id default trigger; updated_at trigger.

New nullable columns on giving_entries (existing rows stay null, untouched):
- recurring_id uuid null references giving_recurring (on delete set null)
- recurring_month date null
- unassigned boolean default false (bucket placeholders)
- split_from uuid null (gifts created from a bucket split)
- Partial unique index (recurring_id, recurring_month) where recurring_id is not null: makes generation idempotent.

Generation:
- SQL function public.generate_recurring_giving() (SECURITY INVOKER, so RLS applies): for every item, for each month from start_month through min(end_month, current month in America/New_York), insert one entry with ON CONFLICT DO NOTHING. Fixed → normal entry (gift_date = first of month). Bucket → recipient = item name, unassigned = true.
- Skips and deletes stick: deleting a generated month's entry records a "skipped" marker instead of a real delete (entry kept with amount 0 and hidden flag `skipped boolean default false`), so catch-up never recreates it.
- Called once when the Giving screen opens and once on app load (silent, fire and forget). Never future months.
- Edit or delete of one generated entry only changes that row.

Bucket assignment:
- Unassigned placeholders show an amber "Assign" badge; header shows "N buckets to assign".
- Assign sheet: set recipient and type, or split into several rows whose total is ≤ bucket amount (validated; remainder dropped). Saving converts the placeholder into the first gift and inserts the others with split_from, in one RPC (assign_giving_bucket) so it can't half-save.

Recurring giving section (Giving screen):
- Active items for the current month with monthly total.
- Edit amount with "effective from" month: ends old item at the month before, creates a new item from that month (single RPC). Past entries keep old amounts. Already-generated entries for the effective month and later are left as is (none exist for future months).
- Add item, Stop item (sets end_month).
- Seed (start 2026-12-01): Radius / Church 1,800; Camp Cedar Cliff 1,000; Young Life - Lex 500; Daybreak 300; Original Design 400 (Charity - Ministry, fixed); buckets "Called giving (church or nonprofit)" Charity - Ministry 500, "Hosting and generosity" Generosity - see notes 500. Total $5,000.
- Totals (month, year, by type, by recipient) exclude unassigned placeholders' recipient breakdown (counted under "Unassigned") and exclude skipped rows.

## 3) 2027 giving goal
- New LinkedMetric 'giving_recurring_month' in goalTracking.ts: per month in 2027, sum of items active that month. Hit when any 2027 month ≥ target; progress shows current month's recurring total vs $6,000; detail line still shows "2027 total given $X" from all entries.
- Data update to that one goal row: linked_metric = 'giving_recurring_month' (giving_month stays supported for other goals).

## Technical details
- Migration: giving_recurring table + grants + RLS, new giving_entries columns + index, generate_recurring_giving, assign_giving_bucket, change_recurring_amount RPCs (invoker, granted to authenticated).
- Files changed: src/lib/giving.ts (recurringMonthlyTotal, activeIn, split validation, totals excluding skipped), src/lib/goalTracking.ts (new metric), src/components/retreat/GivingView.tsx (Assign badge, count, Recurring section), GoalTrackers/GoalEditDialog (metric option), src/pages/Index.tsx or the retreat hook (one silent generate call on load).
- New files: src/components/retreat/RecurringGivingSection.tsx, AssignBucketDialog.tsx; tests in src/test/recurringGiving.test.ts: idempotent months, end_month cutoff, no future months, effective-from split keeps past amounts, split total ≤ bucket, goal hit at $6,000 in a 2027 month and not from a one-off big month.
- Nothing in Home, Budget, Plaid, auth, calendars, to dos changes.
