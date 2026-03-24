
-- Add budget_month column to transactions
ALTER TABLE public.transactions ADD COLUMN budget_month text;

-- Backfill existing transactions using their date
UPDATE public.transactions SET budget_month = to_char(date, 'YYYY-MM');

-- Make it NOT NULL with a default
ALTER TABLE public.transactions ALTER COLUMN budget_month SET NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN budget_month SET DEFAULT to_char(CURRENT_DATE, 'YYYY-MM');

-- Add active_month to households
ALTER TABLE public.households ADD COLUMN active_month text NOT NULL DEFAULT to_char(CURRENT_DATE, 'YYYY-MM');

-- Create snapshot table for past months
CREATE TABLE public.budget_month_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  month text NOT NULL,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  fixed_expenses jsonb NOT NULL DEFAULT '[]'::jsonb,
  transactions_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(household_id, month)
);

ALTER TABLE public.budget_month_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view snapshots"
  ON public.budget_month_snapshots FOR SELECT TO authenticated
  USING (household_id = get_household_id());

CREATE POLICY "Household members can insert snapshots"
  ON public.budget_month_snapshots FOR INSERT TO authenticated
  WITH CHECK (household_id = get_household_id());

-- Allow household members to update their household (for active_month)
CREATE POLICY "Household members can update their household"
  ON public.households FOR UPDATE TO authenticated
  USING (id = get_household_id())
  WITH CHECK (id = get_household_id());
