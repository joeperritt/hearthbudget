CREATE TABLE public.tool_states (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id uuid NOT NULL,
  tool_name text NOT NULL,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (household_id, tool_name)
);

ALTER TABLE public.tool_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view tool states"
ON public.tool_states FOR SELECT TO authenticated
USING (household_id = get_household_id());

CREATE POLICY "Household members can insert tool states"
ON public.tool_states FOR INSERT TO authenticated
WITH CHECK (household_id = get_household_id());

CREATE POLICY "Household members can update tool states"
ON public.tool_states FOR UPDATE TO authenticated
USING (household_id = get_household_id());

CREATE POLICY "Household members can delete tool states"
ON public.tool_states FOR DELETE TO authenticated
USING (household_id = get_household_id());