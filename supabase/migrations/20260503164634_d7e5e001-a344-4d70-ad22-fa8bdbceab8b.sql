-- Prevent duplicate snapshots per (household_id, month). Existing data is already unique per household.
ALTER TABLE public.budget_month_snapshots
  ADD CONSTRAINT budget_month_snapshots_household_month_uniq UNIQUE (household_id, month);