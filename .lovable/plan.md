# Daily Goals, goal tracking in 2717, and Giving

Everything new is additive except removing the store list. No changes to Budget, Calendars, Bank Accounts, Plaid, auth, notifications, to dos, weather or the budget pill.

## Part A: Home

### A1. Remove the store list (for your review)

Important: the store list doesn't have its own table. It shares one table with the family and personal to dos, and each row is marked "todo" or "store". So I will **not drop that table**. That would delete every to do. Instead, I'll delete only the rows marked "store" and stop accepting new ones.

Files removed:
- `src/components/home/HomeListCard.tsx` (the store card, used only by Home's Store tab)

Files changed, store parts only:
- `src/components/home/HomePage.tsx`: remove the `'store'` card, the "Store (n)" tab and the store count. Replace them with `'goals'` (Daily Goals).
- `src/components/home/HomeDataContext.tsx`: remove `useHomeList('store')`. The to do list stays.
- `src/components/home/ListItemEditSheet.tsx`: narrow `kind` to `'todo'`. To do editing is unchanged.
- `src/hooks/useHomeList.ts`: narrow the list type to `'todo'`. Behavior is unchanged.
- `supabase/functions/keeper-assistant/index.ts`: remove `list=store` from `add_list_items`, along with the shopping rule and the "Store List" wording. Shopping requests will get a short reply saying there's no store list. To do adds are unchanged.
- Saved Home layouts (`user_home_layouts.cards`) that contain `'store'` will map to `'goals'` when read. A layout without either gets `'goals'` added. Your card order is otherwise unchanged.
- The saved instant-open copy of store data will be ignored and removed.

Data and database:
- Delete the `home_list_items` rows where `list_type = 'store'`.
- Add a check so new rows can only be `'todo'`, after the delete.

### A2. Daily Goals card (per login)

- **Katie:** the card shows "No goals yet", because she has no habits defined.
- **Joe:**
  - Date header with arrows. It opens to today (America/New_York), and the right arrow is disabled at today.
  - Days before Nov 26, 2026 show "N/A" and can't be edited.
  - Daily habits: Quiet time (yes/no), Family prayer (yes/no), Workouts (minus/plus counter).
  - A smaller "Occasional" section: Date night (I planned it), Family only Sunday dinner, Something with Logan and Lily.
  - Under each habit: this week's count vs target (week runs Sunday to Saturday). Quiet time x of 5, prayer x of 5, workouts x of 4. Occasional items show this month's count vs 1.
  - Year-to-date average per week, plus the current streak. Everything is per calendar year, so 2026 covers Nov 26 to Dec 31 and it resets Jan 1, 2027. The first week's average uses only the days since Nov 26.
- Each tap saves straight to the database and the card updates. It has its own instant-open copy, like the other Home cards.
- Habits come from data, so Katie's can be added later without code.

## Part B: Goal tracking in 2717 → Goals (All Goals)

- **Every goal:** edit its text, add a goal (choose horizon and category), and delete it after you confirm. Long range horizons keep their current look, with an edit menu added.
- **2027 and Every Year goals** get a tracking type with a status chip (On track / Behind / Hit) and a progress bar:
  - **habit:** year-to-date average per week vs target.
  - **monthly:** 12 dots, filled when the linked occasional habit was logged that month.
  - **linked:** calculated automatically from existing 2717 data.
  - **count:** minus/plus toward a target.
  - **checklist:** a done checkbox and the date it was done.
  - **quarterly:** Q1 to Q4 checkboxes.
- **Mapping for the seeded goals, as you listed:**
  - Quiet time, prayer and workouts: habit.
  - Bloodwork twice a year: checklist.
  - Giving: linked to Giving. Hit when any 2027 month is at least $6,000. It also shows the 2027 total so far.
  - Logan and Lily, date night and Sunday dinner: monthly.
  - Physical and bloodwork, dentist, estate documents, anniversary trip, one on ones, 3 to 5 acres, $5M+ client and second location plan: checklist.
  - Production: linked to advisor production. Hit when any 2027 month is at least $30,000. It shows the best month.
  - Emergency fund: the latest "Wealthfront Savings" value vs $40,000.
  - Land: the latest "LPL Joe TOD" value vs $50,000, plus a manual "done" switch.
  - Net worth vs $2M and without Blackbridge vs $500K: from the latest snapshot.
  - $120M AUM: the latest advisor AUM. $12M NNA: the 2027 year-to-date total.
  - Shift 30 households: count to 30. Read 4 books: count to 4. Advisor meetings: quarterly.
  - Linked goals store the line item by its id, never by name.
- **Status rules:**
  - Habit: On track when the year-to-date weekly average is at or above target.
  - Monthly: On track when every finished month this year is filled.
  - Linked, count and checklist: Hit at or above target, otherwise Behind.
  - Quarterly: Behind when a past quarter isn't checked.
- **"Close out year" button:**
  - After you confirm, it opens a list of that year's goals. Each one has Hit / Faded / Short, prefilled from its status, and an optional note.
  - Saving writes the results, copies those goals into Prior Years and writes the scorecard.
  - It won't be run now.

## Part C: Giving (new hub tile between Income and JP Advisor Data)

- A year selector, then entries grouped by month with monthly totals.
- Totals by type, totals by recipient (high to low) and the year total.
- Add, edit and delete entries.
- "Rename recipient" updates every entry with that name, so duplicates can be merged.
- Types: Church, Charity - Ministry, Charity - Other, Generosity - see notes.
- I'll load 2025 and 2026 from the rows you paste after approval. Checks: 2026 through November is $36,400.00 (Church $14,000, Charity - Ministry $14,420, Generosity $7,980). 2025 is $24,542.77 (Church $11,350, Charity - Ministry $8,540, Generosity $4,652.77). I'll report any mismatch rather than adjust numbers.

## Tests
- Week and month windows: Sunday to Saturday, the America/New_York date, the Nov 26 cutoff and the Jan 1 reset.
- Year-to-date weekly average and streak.
- Each tracking status, including the $6,000 giving month, the $30,000 production month, emergency fund and NNA year to date.
- Giving totals against your checks.
- Saved Home layouts map `'store'` to `'goals'`.

## Technical details

New tables (all have GRANTs to authenticated and service_role, no anon, row level security on, `(select auth.uid())` form, household_id filled by the existing default trigger):
- `habit_definitions`: id, household_id, user_id, name, kind (`yes_no`|`counter`), target int, period (`week`|`month`), section (`daily`|`occasional`), sort_order, active, start_date (default 2026-11-26).
  - Read: same household. Write: owner only (`user_id = auth.uid()`).
- `habit_logs`: id, household_id, user_id, habit_id → habit_definitions (cascade), log_date date, value int ≥ 0, unique (user_id, habit_id, log_date), index (user_id, log_date).
  - Read: same household. Write: owner only.
  - A trigger rejects dates before the habit's start_date or after today in America/New_York.
- `giving_entries`: id, household_id, gift_date date, type (check on the 4 types), recipient, amount numeric(12,2), notes. Index (household_id, gift_date).
  - Household read/write.
- `retreat_goals`, additive nullable/defaulted columns: tracking_type, target numeric, linked_metric (`giving_month`|`production_month`|`nw_line_item`|`net_worth`|`net_worth_ex_business`|`advisor_aum`|`advisor_nna_ytd`), linked_line_item_id uuid, habit_id uuid, progress jsonb default '{}' (count, done and done date, quarter checks, manual override).
- Seed: Joe's 6 habits; the tracking mapping for the seeded 2027 and Every Year goals (line items looked up by id at seed time); giving rows after you paste them.
- Close out: insert copies with `retreat_year = year - 1` style consistent with the existing prior year rows (horizon = that year, result, result_note), plus a `retreat_scorecards` row, in one call.

New files:
- `src/components/home/DailyGoalsCard.tsx`
- `src/hooks/useDailyGoals.ts`
- `src/lib/habits.ts` (week/month windows, averages, streak)
- `src/lib/goalTracking.ts` (status per tracking type)
- `src/components/retreat/GoalEditDialog.tsx`, `GoalTrackers.tsx`, `CloseOutYearDialog.tsx`, `GivingView.tsx`
- Tests next to the existing ones

Changed: `GoalsView.tsx`, `RetreatHub.tsx` (Giving tile), `useRetreatData.ts` (read giving and habit totals), plus the Home and assistant files listed in A1.

Unchanged: Budget, the budget pill, calendars, to dos, weather, Plaid, auth, notifications and cron.
