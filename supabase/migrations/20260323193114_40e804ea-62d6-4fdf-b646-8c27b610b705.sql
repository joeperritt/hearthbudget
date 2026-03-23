-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

-- Create households table
CREATE TABLE public.households (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'My Household',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_initial TEXT NOT NULL DEFAULT 'U',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user_roles table (separate from profiles per security guidelines)
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Function to get the household_id for current user
CREATE OR REPLACE FUNCTION public.get_household_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT household_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- Budget categories table
CREATE TABLE public.budget_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  budgeted NUMERIC NOT NULL DEFAULT 0,
  "group" TEXT NOT NULL CHECK ("group" IN ('shared', 'joe', 'katie')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, slug)
);

-- Fixed expenses table
CREATE TABLE public.fixed_expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  "group" TEXT NOT NULL CHECK ("group" IN ('bills', 'savings', 'tithe')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, slug)
);

-- Transactions table
CREATE TABLE public.transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  category_slug TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL,
  account TEXT NOT NULL CHECK (account IN ('joe-amex', 'katie-amex', 'checking')),
  is_transfer_to_savings BOOLEAN NOT NULL DEFAULT false,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('expense', 'budget-adjustment')) DEFAULT 'expense',
  entered_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Budget transfers table
CREATE TABLE public.budget_transfers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  from_category_slug TEXT NOT NULL,
  to_category_slug TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_transfers ENABLE ROW LEVEL SECURITY;

-- Household: members can see their own household
CREATE POLICY "Members can view their household"
  ON public.households FOR SELECT TO authenticated
  USING (id = public.get_household_id());

-- Profiles: household members can see each other
CREATE POLICY "Household members can view profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (household_id = public.get_household_id());

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- Admin can manage profiles
CREATE POLICY "Admin can insert profiles"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- User roles: admins can manage, users can read own
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Budget categories: household members can read and manage
CREATE POLICY "Household members can view categories"
  ON public.budget_categories FOR SELECT TO authenticated
  USING (household_id = public.get_household_id());

CREATE POLICY "Household members can manage categories"
  ON public.budget_categories FOR ALL TO authenticated
  USING (household_id = public.get_household_id());

-- Fixed expenses: same pattern
CREATE POLICY "Household members can view expenses"
  ON public.fixed_expenses FOR SELECT TO authenticated
  USING (household_id = public.get_household_id());

CREATE POLICY "Household members can manage expenses"
  ON public.fixed_expenses FOR ALL TO authenticated
  USING (household_id = public.get_household_id());

-- Transactions: household members can CRUD
CREATE POLICY "Household members can view transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (household_id = public.get_household_id());

CREATE POLICY "Household members can insert transactions"
  ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (household_id = public.get_household_id());

CREATE POLICY "Household members can delete transactions"
  ON public.transactions FOR DELETE TO authenticated
  USING (household_id = public.get_household_id());

-- Budget transfers: household members can CRUD
CREATE POLICY "Household members can view transfers"
  ON public.budget_transfers FOR SELECT TO authenticated
  USING (household_id = public.get_household_id());

CREATE POLICY "Household members can insert transfers"
  ON public.budget_transfers FOR INSERT TO authenticated
  WITH CHECK (household_id = public.get_household_id());

-- Enable realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.budget_categories;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fixed_expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.budget_transfers;

-- Trigger for updated_at on profiles
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_transactions_household ON public.transactions(household_id);
CREATE INDEX idx_transactions_date ON public.transactions(date);
CREATE INDEX idx_budget_categories_household ON public.budget_categories(household_id);
CREATE INDEX idx_fixed_expenses_household ON public.fixed_expenses(household_id);
CREATE INDEX idx_budget_transfers_household ON public.budget_transfers(household_id);
CREATE INDEX idx_profiles_household ON public.profiles(household_id);
CREATE INDEX idx_profiles_user ON public.profiles(user_id);