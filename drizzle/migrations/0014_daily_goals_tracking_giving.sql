CREATE TABLE public.habit_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'yes_no' CHECK (kind IN ('yes_no','counter')),
  target integer NOT NULL DEFAULT 1,
  period text NOT NULL DEFAULT 'week' CHECK (period IN ('week','month')),
  section text NOT NULL DEFAULT 'daily' CHECK (section IN ('daily','occasional')),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  start_date date NOT NULL DEFAULT '2026-11-26',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_definitions TO authenticated;
GRANT ALL ON public.habit_definitions TO service_role;
ALTER TABLE public.habit_definitions ENABLE ROW LEVEL SECURITY;
CREATE INDEX habit_definitions_household_idx ON public.habit_definitions (household_id);
CREATE INDEX habit_definitions_user_idx ON public.habit_definitions (user_id, sort_order);
CREATE POLICY "Household reads habits" ON public.habit_definitions FOR SELECT TO authenticated USING (household_id = (select public.get_household_id()));
CREATE POLICY "Owner inserts habits" ON public.habit_definitions FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()) AND household_id = (select public.get_household_id()));
CREATE POLICY "Owner updates habits" ON public.habit_definitions FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()) AND household_id = (select public.get_household_id()));
CREATE POLICY "Owner deletes habits" ON public.habit_definitions FOR DELETE TO authenticated USING (user_id = (select auth.uid()));
CREATE TRIGGER habit_definitions_household BEFORE INSERT ON public.habit_definitions FOR EACH ROW EXECUTE FUNCTION public.set_household_id_default();
CREATE TRIGGER habit_definitions_updated BEFORE UPDATE ON public.habit_definitions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.habit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  habit_id uuid NOT NULL REFERENCES public.habit_definitions(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  value integer NOT NULL DEFAULT 0 CHECK (value >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, habit_id, log_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_logs TO authenticated;
GRANT ALL ON public.habit_logs TO service_role;
ALTER TABLE public.habit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX habit_logs_user_date_idx ON public.habit_logs (user_id, log_date);
CREATE INDEX habit_logs_habit_idx ON public.habit_logs (habit_id);
CREATE INDEX habit_logs_household_idx ON public.habit_logs (household_id);
CREATE POLICY "Household reads habit logs" ON public.habit_logs FOR SELECT TO authenticated USING (household_id = (select public.get_household_id()));
CREATE POLICY "Owner inserts habit logs" ON public.habit_logs FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()) AND household_id = (select public.get_household_id()));
CREATE POLICY "Owner updates habit logs" ON public.habit_logs FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Owner deletes habit logs" ON public.habit_logs FOR DELETE TO authenticated USING (user_id = (select auth.uid()));
CREATE TRIGGER habit_logs_household BEFORE INSERT ON public.habit_logs FOR EACH ROW EXECUTE FUNCTION public.set_household_id_default();
CREATE TRIGGER habit_logs_updated BEFORE UPDATE ON public.habit_logs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.habit_log_validate() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _start date; _owner uuid;
BEGIN
  SELECT start_date, user_id INTO _start, _owner FROM public.habit_definitions WHERE id = NEW.habit_id;
  IF _owner IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'Habit belongs to another user'; END IF;
  IF NEW.log_date < _start THEN RAISE EXCEPTION 'Days before % cannot be logged', _start; END IF;
  IF NEW.log_date > (now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'Future days cannot be logged'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER habit_logs_validate BEFORE INSERT OR UPDATE ON public.habit_logs FOR EACH ROW EXECUTE FUNCTION public.habit_log_validate();

CREATE TABLE public.giving_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  gift_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('Church','Charity - Ministry','Charity - Other','Generosity - see notes')),
  recipient text NOT NULL DEFAULT '',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.giving_entries TO authenticated;
GRANT ALL ON public.giving_entries TO service_role;
ALTER TABLE public.giving_entries ENABLE ROW LEVEL SECURITY;
CREATE INDEX giving_entries_household_date_idx ON public.giving_entries (household_id, gift_date);
CREATE POLICY "Household reads giving" ON public.giving_entries FOR SELECT TO authenticated USING (household_id = (select public.get_household_id()));
CREATE POLICY "Household inserts giving" ON public.giving_entries FOR INSERT TO authenticated WITH CHECK (household_id = (select public.get_household_id()));
CREATE POLICY "Household updates giving" ON public.giving_entries FOR UPDATE TO authenticated USING (household_id = (select public.get_household_id())) WITH CHECK (household_id = (select public.get_household_id()));
CREATE POLICY "Household deletes giving" ON public.giving_entries FOR DELETE TO authenticated USING (household_id = (select public.get_household_id()));
CREATE TRIGGER giving_entries_household BEFORE INSERT ON public.giving_entries FOR EACH ROW EXECUTE FUNCTION public.set_household_id_default();
CREATE TRIGGER giving_entries_updated BEFORE UPDATE ON public.giving_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.retreat_goals
  ADD COLUMN tracking_type text CHECK (tracking_type IN ('habit','monthly','linked','count','checklist','quarterly')),
  ADD COLUMN target numeric,
  ADD COLUMN linked_metric text CHECK (linked_metric IN ('giving_month','production_month','nw_line_item','net_worth','net_worth_ex_business','advisor_aum','advisor_nna_ytd')),
  ADD COLUMN linked_line_item_id uuid REFERENCES public.nw_line_items(id) ON DELETE SET NULL,
  ADD COLUMN habit_id uuid REFERENCES public.habit_definitions(id) ON DELETE SET NULL,
  ADD COLUMN progress jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX retreat_goals_line_item_idx ON public.retreat_goals (linked_line_item_id);
CREATE INDEX retreat_goals_habit_idx ON public.retreat_goals (habit_id);