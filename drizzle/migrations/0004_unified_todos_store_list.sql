ALTER TABLE public.home_list_items ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.home_list_items ADD COLUMN IF NOT EXISTS due_time time;
ALTER TABLE public.home_list_items ADD COLUMN IF NOT EXISTS notes text CHECK (notes IS NULL OR char_length(notes) <= 2000);
ALTER TABLE public.home_list_items DROP CONSTRAINT IF EXISTS home_list_items_list_type_check;
ALTER TABLE public.home_list_items DROP CONSTRAINT IF EXISTS home_list_items_check;
UPDATE public.home_list_items SET list_type = 'todo', user_id = NULL WHERE list_type = 'family';
UPDATE public.home_list_items SET list_type = 'todo' WHERE list_type = 'personal';
UPDATE public.home_list_items SET list_type = 'store', user_id = NULL WHERE list_type = 'grocery';
ALTER TABLE public.home_list_items ADD CONSTRAINT home_list_items_list_type_check CHECK (list_type IN ('todo', 'store'));
COMMENT ON COLUMN public.home_list_items.user_id IS 'To do owner; null = Family. Always null for store items.';

DROP POLICY IF EXISTS "list items visible" ON public.home_list_items;
DROP POLICY IF EXISTS "list items insert" ON public.home_list_items;
DROP POLICY IF EXISTS "list items update" ON public.home_list_items;
DROP POLICY IF EXISTS "list items delete" ON public.home_list_items;
CREATE POLICY "list items visible" ON public.home_list_items FOR SELECT TO authenticated USING (household_id = public.get_household_id());
CREATE POLICY "list items insert" ON public.home_list_items FOR INSERT TO authenticated WITH CHECK (household_id = public.get_household_id() AND (user_id IS NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = home_list_items.user_id AND p.household_id = public.get_household_id())));
CREATE POLICY "list items update" ON public.home_list_items FOR UPDATE TO authenticated USING (household_id = public.get_household_id()) WITH CHECK (household_id = public.get_household_id() AND (user_id IS NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = home_list_items.user_id AND p.household_id = public.get_household_id())));
CREATE POLICY "list items delete" ON public.home_list_items FOR DELETE TO authenticated USING (household_id = public.get_household_id());

ALTER TABLE public.user_home_layouts ADD COLUMN IF NOT EXISTS todo_visibility jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.set_home_todo_visibility(owner_key text, visible boolean)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF owner_key <> 'family' AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id::text = owner_key AND household_id = public.get_household_id()) THEN
    RAISE EXCEPTION 'Owner not found';
  END IF;
  INSERT INTO public.user_home_layouts (user_id, cards, todo_visibility, updated_at)
  VALUES (auth.uid(), '["calendar","todo","store"]'::jsonb, jsonb_build_object(owner_key, visible), now())
  ON CONFLICT (user_id) DO UPDATE SET todo_visibility = public.user_home_layouts.todo_visibility || jsonb_build_object(owner_key, visible), updated_at = now();
END; $$;
GRANT EXECUTE ON FUNCTION public.set_home_todo_visibility(text, boolean) TO authenticated;