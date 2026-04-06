
-- Add nickname and account_category to plaid_accounts
ALTER TABLE public.plaid_accounts ADD COLUMN IF NOT EXISTS nickname text;
ALTER TABLE public.plaid_accounts ADD COLUMN IF NOT EXISTS account_category text NOT NULL DEFAULT 'credit_card';

-- Create plaid_cardholders table for credit card sub-holders
CREATE TABLE public.plaid_cardholders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plaid_account_id uuid REFERENCES public.plaid_accounts(id) ON DELETE CASCADE NOT NULL,
  household_id uuid REFERENCES public.households(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  match_patterns text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.plaid_cardholders ENABLE ROW LEVEL SECURITY;

-- RLS policies for plaid_cardholders
CREATE POLICY "Users can view own household cardholders"
  ON public.plaid_cardholders FOR SELECT TO authenticated
  USING (household_id = public.get_household_id());

CREATE POLICY "Users can insert own household cardholders"
  ON public.plaid_cardholders FOR INSERT TO authenticated
  WITH CHECK (household_id = public.get_household_id());

CREATE POLICY "Users can update own household cardholders"
  ON public.plaid_cardholders FOR UPDATE TO authenticated
  USING (household_id = public.get_household_id());

CREATE POLICY "Users can delete own household cardholders"
  ON public.plaid_cardholders FOR DELETE TO authenticated
  USING (household_id = public.get_household_id());

-- Migrate existing data: Set Wells Fargo checking account
UPDATE public.plaid_accounts 
SET nickname = 'Checking', account_category = 'checking', app_account = 'checking'
WHERE type = 'depository' AND (subtype = 'checking' OR subtype IS NULL);

-- Set Amex as credit_card
UPDATE public.plaid_accounts 
SET account_category = 'credit_card'
WHERE type = 'credit';

-- Create cardholders for existing Amex accounts
INSERT INTO public.plaid_cardholders (plaid_account_id, household_id, name, slug, match_patterns)
SELECT pa.id, pa.household_id, 'Joe''s Amex', 'joe-amex', ARRAY['joseph', 'joe']
FROM public.plaid_accounts pa
WHERE pa.type = 'credit' AND pa.app_account = 'joe-amex';

INSERT INTO public.plaid_cardholders (plaid_account_id, household_id, name, slug, match_patterns)
SELECT pa.id, pa.household_id, 'Katie''s Amex', 'katie-amex', ARRAY['katherine', 'katie']
FROM public.plaid_accounts pa
WHERE pa.type = 'credit' AND pa.app_account = 'joe-amex';
