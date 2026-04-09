
ALTER TABLE public.financial_profiles
  ADD COLUMN IF NOT EXISTS member_incomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS filing_status text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS state text NULL,
  ADD COLUMN IF NOT EXISTS non_retirement_investments numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS roth_retirement_balance numeric DEFAULT 0;
