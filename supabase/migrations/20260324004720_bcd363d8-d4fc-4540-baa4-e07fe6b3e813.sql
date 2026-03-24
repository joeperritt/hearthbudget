
-- Table to store Plaid Items (each bank connection)
CREATE TABLE public.plaid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  item_id text NOT NULL UNIQUE,
  institution_name text NOT NULL DEFAULT '',
  cursor text,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view plaid items"
  ON public.plaid_items FOR SELECT TO authenticated
  USING (household_id = get_household_id());

CREATE POLICY "Household members can insert plaid items"
  ON public.plaid_items FOR INSERT TO authenticated
  WITH CHECK (household_id = get_household_id());

CREATE POLICY "Household members can update plaid items"
  ON public.plaid_items FOR UPDATE TO authenticated
  USING (household_id = get_household_id());

CREATE POLICY "Household members can delete plaid items"
  ON public.plaid_items FOR DELETE TO authenticated
  USING (household_id = get_household_id());

-- Table to store Plaid Accounts and their mapping to app accounts
CREATE TABLE public.plaid_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plaid_item_id uuid NOT NULL REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  plaid_account_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  official_name text,
  type text NOT NULL DEFAULT '',
  subtype text,
  mask text,
  app_account text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.plaid_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view plaid accounts"
  ON public.plaid_accounts FOR SELECT TO authenticated
  USING (household_id = get_household_id());

CREATE POLICY "Household members can insert plaid accounts"
  ON public.plaid_accounts FOR INSERT TO authenticated
  WITH CHECK (household_id = get_household_id());

CREATE POLICY "Household members can update plaid accounts"
  ON public.plaid_accounts FOR UPDATE TO authenticated
  USING (household_id = get_household_id());

CREATE POLICY "Household members can delete plaid accounts"
  ON public.plaid_accounts FOR DELETE TO authenticated
  USING (household_id = get_household_id());
