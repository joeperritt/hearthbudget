ALTER TABLE public.financial_profiles
  ADD COLUMN IF NOT EXISTS life_insurance_coverages jsonb NOT NULL DEFAULT '[]'::jsonb;