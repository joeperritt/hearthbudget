CREATE OR REPLACE FUNCTION public.set_household_id_default()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.household_id IS NULL THEN NEW.household_id := public.get_household_id(); END IF;
  RETURN NEW;
END $$;

CREATE TABLE public.retreat_visions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  retreat_year integer NOT NULL,
  label text NOT NULL,
  text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.retreat_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  retreat_year integer NOT NULL,
  horizon text NOT NULL,
  category text NOT NULL,
  text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  result text CHECK (result IN ('hit','faded','short')),
  result_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.retreat_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  year integer NOT NULL,
  summary_line text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, year)
);
CREATE TABLE public.nw_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  section text NOT NULL CHECK (section IN ('asset','liability')),
  category text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  is_business_equity boolean NOT NULL DEFAULT false,
  is_business_loan boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.nw_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  snapshot_month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, snapshot_month)
);
CREATE TABLE public.nw_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES public.nw_snapshots(id) ON DELETE CASCADE,
  line_item_id uuid NOT NULL REFERENCES public.nw_line_items(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, line_item_id)
);
CREATE TABLE public.income_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  year integer NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.income_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES public.income_sources(id) ON DELETE CASCADE,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, month)
);
CREATE TABLE public.advisor_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  month date NOT NULL,
  aum numeric,
  nna numeric,
  production numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, month)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['retreat_visions','retreat_goals','retreat_scorecards','nw_line_items','nw_snapshots','nw_values','income_sources','income_entries','advisor_monthly'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Household members can view %1$s" ON public.%1$I FOR SELECT TO authenticated USING (household_id = public.get_household_id())', t);
    EXECUTE format('CREATE POLICY "Household members can insert %1$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (household_id = public.get_household_id())', t);
    EXECUTE format('CREATE POLICY "Household members can update %1$s" ON public.%1$I FOR UPDATE TO authenticated USING (household_id = public.get_household_id()) WITH CHECK (household_id = public.get_household_id())', t);
    EXECUTE format('CREATE POLICY "Household members can delete %1$s" ON public.%1$I FOR DELETE TO authenticated USING (household_id = public.get_household_id())', t);
    EXECUTE format('CREATE TRIGGER %1$s_household_default BEFORE INSERT ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.set_household_id_default()', t);
    EXECUTE format('CREATE TRIGGER %1$s_updated_at BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

CREATE INDEX retreat_goals_household_year_idx ON public.retreat_goals (household_id, retreat_year);
CREATE INDEX nw_values_snapshot_idx ON public.nw_values (snapshot_id);
CREATE INDEX income_sources_household_year_idx ON public.income_sources (household_id, year);