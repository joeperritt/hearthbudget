-- Add onboarding_completed flag to households so we can gate the onboarding flow
-- without breaking existing users. All existing households are marked TRUE so
-- they never see onboarding. New households default FALSE so signup -> onboarding.
ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Mark every existing household as already onboarded — protects Joe + Katie's
-- real data and any other live households from suddenly seeing the flow.
UPDATE public.households SET onboarding_completed = true;

-- New households created from here on should start un-onboarded.
ALTER TABLE public.households
  ALTER COLUMN onboarding_completed SET DEFAULT false;