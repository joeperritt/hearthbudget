CREATE TABLE public.budget_amount_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id uuid NOT NULL,
  slug text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('category', 'fixed')),
  month text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (household_id, slug, kind, month)
);

CREATE INDEX idx_budget_amount_overrides_lookup
  ON public.budget_amount_overrides (household_id, month);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_amount_overrides TO authenticated;
GRANT ALL ON public.budget_amount_overrides TO service_role;

ALTER TABLE public.budget_amount_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view budget amount overrides"
  ON public.budget_amount_overrides
  FOR SELECT
  TO authenticated
  USING (household_id = public.get_household_id());

CREATE POLICY "Household members can insert budget amount overrides"
  ON public.budget_amount_overrides
  FOR INSERT
  TO authenticated
  WITH CHECK (household_id = public.get_household_id());

CREATE POLICY "Household members can update budget amount overrides"
  ON public.budget_amount_overrides
  FOR UPDATE
  TO authenticated
  USING (household_id = public.get_household_id())
  WITH CHECK (household_id = public.get_household_id());

CREATE POLICY "Household members can delete budget amount overrides"
  ON public.budget_amount_overrides
  FOR DELETE
  TO authenticated
  USING (household_id = public.get_household_id());

CREATE TRIGGER update_budget_amount_overrides_updated_at
  BEFORE UPDATE ON public.budget_amount_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();