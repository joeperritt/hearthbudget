ALTER TABLE public.household_calendars ADD COLUMN IF NOT EXISTS read_only boolean NOT NULL DEFAULT false;
UPDATE public.household_calendars SET read_only = true WHERE google_calendar_id IS NULL OR btrim(google_calendar_id) = '';
CREATE OR REPLACE FUNCTION public.household_calendar_force_read_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.google_calendar_id IS NULL OR btrim(NEW.google_calendar_id) = '' THEN NEW.read_only := true; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS household_calendars_force_read_only ON public.household_calendars;
CREATE TRIGGER household_calendars_force_read_only BEFORE INSERT OR UPDATE ON public.household_calendars
FOR EACH ROW EXECUTE FUNCTION public.household_calendar_force_read_only();