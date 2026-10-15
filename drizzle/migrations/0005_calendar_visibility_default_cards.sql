CREATE OR REPLACE FUNCTION public.set_home_calendar_visibility(calendar_id uuid, visible boolean)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
IF NOT EXISTS (SELECT 1 FROM public.household_calendars WHERE id = calendar_id AND household_id = public.get_household_id()) THEN RAISE EXCEPTION 'Calendar not found'; END IF;
INSERT INTO public.user_home_layouts (user_id, cards, calendar_visibility, updated_at) VALUES (auth.uid(), '["calendar","todo","store"]'::jsonb, jsonb_build_object(calendar_id::text, visible), now())
ON CONFLICT (user_id) DO UPDATE SET calendar_visibility = public.user_home_layouts.calendar_visibility || jsonb_build_object(calendar_id::text, visible), updated_at = now();
END; $$;