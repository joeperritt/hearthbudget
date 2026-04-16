ALTER TABLE public.financial_profiles
  ADD COLUMN IF NOT EXISTS non_retirement_per_member jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS retirement_balance_per_member jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS roth_balance_per_member jsonb NOT NULL DEFAULT '{}'::jsonb;