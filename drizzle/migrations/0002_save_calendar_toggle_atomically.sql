CREATE OR REPLACE FUNCTION public.set_home_calendar_visibility(calendar_id uuid, visible boolean) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
IF NOT EXISTS (SELECT 1 FROM public.household_calendars WHERE id = calendar_id AND household_id = public.get_household_id()) THEN RAISE EXCEPTION 'Calendar not found'; END IF;
INSERT INTO public.user_home_layouts (user_id, cards, calendar_visibility, updated_at) VALUES (auth.uid(), '["weather","calendar","budget","family_todo","my_todo","grocery"]'::jsonb, jsonb_build_object(calendar_id::text, visible), now())
ON CONFLICT (user_id) DO UPDATE SET calendar_visibility = public.user_home_layouts.calendar_visibility || jsonb_build_object(calendar_id::text, visible), updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_home_calendar_visibility(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_home_calendar_visibility(uuid, boolean) TO authenticated;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='user_home_layouts') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_home_layouts; END IF; IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='household_calendars') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.household_calendars; END IF; END $$;