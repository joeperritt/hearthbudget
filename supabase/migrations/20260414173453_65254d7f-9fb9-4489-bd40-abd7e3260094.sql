ALTER TABLE public.financial_profiles
  ADD COLUMN IF NOT EXISTS mortgage_statement_month text DEFAULT '',
  ADD COLUMN IF NOT EXISTS mortgage_pi numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mortgage_escrow numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mortgage_extra numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mortgage_breakdown_enabled boolean DEFAULT false;