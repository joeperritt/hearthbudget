-- Add stewardship + composition flags to households
ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS stewardship_mode boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS has_kids boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_pets boolean NOT NULL DEFAULT false;

-- Backfill has_kids: true if any dependent in financial_profiles.dependents has age < 18
UPDATE public.households h
SET has_kids = true
WHERE EXISTS (
  SELECT 1
  FROM public.financial_profiles fp,
       jsonb_array_elements(fp.dependents) AS dep
  WHERE fp.household_id = h.id
    AND COALESCE((dep->>'age')::int, 99) < 18
);

-- Joe's household override: actual parent (son Thomas born March 26, 2026), dependents not yet entered
UPDATE public.households
SET has_kids = true, has_pets = true
WHERE id = '6c4e60db-1b94-41a1-935c-91d851966a50';

-- Stewardship mode defaults ON for all existing households (CKA target audience)
UPDATE public.households SET stewardship_mode = true;

-- Auto-remap retired bucket keys in category_bucket_map (Option A)
-- subscriptions, gifts, personal -> lifestyle
-- utilities -> housing
-- debt -> non_housing_debt
UPDATE public.category_bucket_map
  SET bucket_key = 'lifestyle', updated_at = now()
  WHERE bucket_key IN ('subscriptions', 'gifts', 'personal');

UPDATE public.category_bucket_map
  SET bucket_key = 'housing', updated_at = now()
  WHERE bucket_key = 'utilities';

UPDATE public.category_bucket_map
  SET bucket_key = 'non_housing_debt', updated_at = now()
  WHERE bucket_key = 'debt';