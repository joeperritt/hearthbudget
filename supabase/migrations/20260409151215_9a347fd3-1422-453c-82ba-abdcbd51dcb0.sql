
CREATE TABLE public.financial_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL,
  annual_gross_income NUMERIC NOT NULL DEFAULT 0,
  income_type TEXT NOT NULL DEFAULT 'w2',
  housing_type TEXT NOT NULL DEFAULT 'rent',
  mortgage_balance NUMERIC DEFAULT 0,
  mortgage_rate NUMERIC DEFAULT 0,
  mortgage_payment NUMERIC DEFAULT 0,
  monthly_rent NUMERIC DEFAULT 0,
  debts JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_investment_balance NUMERIC DEFAULT 0,
  retirement_balance NUMERIC DEFAULT 0,
  emergency_fund_balance NUMERIC DEFAULT 0,
  has_life_insurance BOOLEAN DEFAULT false,
  life_insurance_coverage NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (household_id)
);

ALTER TABLE public.financial_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view their financial profile"
  ON public.financial_profiles
  FOR SELECT
  TO authenticated
  USING (household_id = get_household_id());

CREATE POLICY "Household members can create their financial profile"
  ON public.financial_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_household_id());

CREATE POLICY "Household members can update their financial profile"
  ON public.financial_profiles
  FOR UPDATE
  TO authenticated
  USING (household_id = get_household_id());

CREATE TRIGGER update_financial_profiles_updated_at
  BEFORE UPDATE ON public.financial_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
