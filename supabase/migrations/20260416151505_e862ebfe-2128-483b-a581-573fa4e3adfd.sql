ALTER TABLE public.financial_profiles 
  ADD COLUMN IF NOT EXISTS renters_insurance boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS renters_insurance_premium numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_end_date text DEFAULT null;