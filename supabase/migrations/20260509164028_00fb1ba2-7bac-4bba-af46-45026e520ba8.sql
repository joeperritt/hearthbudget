ALTER TABLE public.financial_profiles
ADD COLUMN IF NOT EXISTS non_retirement_intent jsonb NOT NULL DEFAULT '{}'::jsonb;