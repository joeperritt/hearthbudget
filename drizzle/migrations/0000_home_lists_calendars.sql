CREATE TABLE public.home_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  list_type text NOT NULL CHECK (list_type IN ('family','personal','grocery')),
  user_id uuid,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (list_type <> 'personal' OR user_id IS NOT NULL)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.home_list_items TO authenticated;
GRANT ALL ON public.home_list_items TO service_role;
ALTER TABLE public.home_list_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "list items visible" ON public.home_list_items FOR SELECT TO authenticated
  USING (household_id = public.get_household_id() AND (list_type <> 'personal' OR user_id = auth.uid()));
CREATE POLICY "list items insert" ON public.home_list_items FOR INSERT TO authenticated
  WITH CHECK (household_id = public.get_household_id() AND (list_type <> 'personal' OR user_id = auth.uid()));
CREATE POLICY "list items update" ON public.home_list_items FOR UPDATE TO authenticated
  USING (household_id = public.get_household_id() AND (list_type <> 'personal' OR user_id = auth.uid()))
  WITH CHECK (household_id = public.get_household_id() AND (list_type <> 'personal' OR user_id = auth.uid()));
CREATE POLICY "list items delete" ON public.home_list_items FOR DELETE TO authenticated
  USING (household_id = public.get_household_id() AND (list_type <> 'personal' OR user_id = auth.uid()));
CREATE INDEX ON public.home_list_items (household_id, list_type);
ALTER TABLE public.home_list_items REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.home_list_items;

CREATE TABLE public.household_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  label text NOT NULL DEFAULT 'Calendar',
  ics_url text NOT NULL CHECK (ics_url ~ '^https://'),
  added_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_calendars TO authenticated;
GRANT ALL ON public.household_calendars TO service_role;
ALTER TABLE public.household_calendars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calendars household" ON public.household_calendars FOR ALL TO authenticated
  USING (household_id = public.get_household_id())
  WITH CHECK (household_id = public.get_household_id());

CREATE TABLE public.user_home_layouts (
  user_id uuid PRIMARY KEY,
  cards jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_home_layouts TO authenticated;
GRANT ALL ON public.user_home_layouts TO service_role;
ALTER TABLE public.user_home_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own layout" ON public.user_home_layouts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());