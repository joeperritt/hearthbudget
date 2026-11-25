# 2717 — Goals, Net Worth, Income, JP Advisor Data

Purely additive. New tables, new components, one new tile on More, and one new sub view route in Index.tsx. Nothing else changes.

## Navigation
- `ProfileTab.tsx`: add one `Tile` "2717" / "Goals, net worth, income, advisor data", calling the existing `onNavigate('2717')`.
- `Index.tsx`: add `'2717'` to the `ProfileSubView` union and one render block `profileSubView === '2717'` showing `<RetreatHub onBack={() => setProfileSubView('menu')} />`.
- Inside the hub, its own internal state switches between hub / goals / net-worth / income / advisor. Each screen's Back goes to the hub, and the hub's Back goes to More. That's the same header and back pattern as CalendarSettingsView.
- The desktop sidebar (SideNav) is not touched. On desktop, the tile is reached from the More page.

## Tables (all in public, all with household_id = Perritt Family)
| Table | Key columns |
|---|---|
| `retreat_visions` | household_id, retreat_year, label ("Our family", "2030"), text, sort_order |
| `retreat_goals` | household_id, retreat_year, horizon, category, text, sort_order, result (hit/faded/short, null), result_note |
| `retreat_scorecards` | household_id, year, summary_line (pattern text). The counts are calculated from the goals. |
| `nw_line_items` | household_id, section (asset/liability), category, name, sort_order, active, is_business_equity, is_business_loan |
| `nw_snapshots` | household_id, snapshot_month (date, first of month, unique per household) |
| `nw_values` | household_id, snapshot_id → nw_snapshots (cascade), line_item_id → nw_line_items, amount, unique(snapshot_id, line_item_id) |
| `income_sources` | household_id, year, name, sort_order |
| `income_entries` | household_id, source_id → income_sources (cascade), month (1–12), amount, unique(source_id, month) |
| `advisor_monthly` | household_id, month (date), aum, nna, production (each nullable), unique(household_id, month) |

**Access rules (same for every table, matching tool_states):** grant SELECT/INSERT/UPDATE/DELETE to authenticated and ALL to service_role, with no anon access. RLS is on, with four policies: select, insert (with check), update and delete, all `household_id = get_household_id()`. Joe and Katie both see and edit everything. A shared trigger fills household_id on insert when it's missing. `updated_at` is maintained with the existing `update_updated_at_column()`.

## Seed
One-time inserts for household 6c4e60db-… with every value from your message:
- **Goals:** the 2026 retreat goals and both vision statements (retreat_year 2026, horizons Every Year/2027/2030/2035/2040/2045/2065), plus the 14 prior-year 2026 goals with results and notes and the pattern line. The prior-year goals are stored under retreat_year 2025 with horizon "2026", so they sit apart from the current set.
- **Net worth:** 4 snapshots and all line items, with the business equity and BBF loan flags.
- **Income:** the 2026 sources and Jan–Nov values. December stays blank.
- **Advisor:** production for 2024–2026, plus AUM and NNA. Unknown cells stay null.
- **Checks after seeding:** Nov 2026 assets 2,452,511, liabilities 1,314,832, net worth 1,137,679. Oct 2025 net worth 241,046. 2026 income through November 340,378.53. Scorecard 9 hit / 3 faded / 2 short.

## Screens
- **Goals:** "All Goals" / "Prior Years" toggle.
  - All Goals shows the vision cards, then a section per horizon (Every Year first, then by year) with category groups.
  - Prior Years has a year selector, a scorecard summary and goals with colored result badges (Hit green, Faded amber, Short red) and notes.
  - Read-only.
- **Net Worth:** classic balance sheet.
  - Sticky first column, right-aligned whole dollars, negatives in parentheses, subtle striping and bold totals with a top rule.
  - Category subtotals (Cryptocurrency shows $0), Total Assets, Total Liabilities, Net Worth, and Net Worth without Blackbridge (worked out from the flags).
  - Default view is the latest snapshot vs the one about a year earlier, plus change in $ and %. A toggle shows all snapshots with horizontal scroll.
  - Actions: Add update (any month, prefilled from the latest snapshot), tap a value to edit, add a line item, deactivate a line item (history kept), delete a snapshot with a confirmation.
- **Income:** year selector, month rows, source columns, Total column and Total row, cents shown, sticky month column. Tap a cell to edit, and add or remove a source.
- **JP Advisor Data:** year selector, a Month | AUM | NNA | Production table with editable cells, and Add month.
  - Summary: total production, average monthly production, best month, latest AUM, year-to-date NNA.
  - The averages only count months that have a value.

Styling uses the existing tokens and fonts (Playfair headers, DM Sans body), with shadcn Sheet/Dialog for edits.

## Files
**New**
- `src/components/retreat/RetreatHub.tsx`, `GoalsView.tsx`, `NetWorthView.tsx`, `IncomeView.tsx`, `AdvisorDataView.tsx`, plus small edit sheets.
- `src/hooks/useRetreatData.ts` (queries and mutations).
- `src/lib/netWorth.ts` (totals and change math).
- `src/test/netWorth.test.ts`: checks the Nov 2026 and Oct 2025 totals, net worth without Blackbridge, the income total and the scorecard counts.

**Changed (only these two)**
- `ProfileTab.tsx`: one Tile.
- `Index.tsx`: the union member and one render block.

`types.ts` is regenerated automatically after the migration, and AGENTS.md gets one rule for the 2717 data. No existing tables, hooks or feature components are modified.

## Assumption
Prior-year goals are stored as retreat_year 2025 (set at the 2025 retreat) with horizon "2026", and the Prior Years selector is labeled by goal year ("2026").
