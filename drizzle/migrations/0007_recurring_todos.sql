ALTER TABLE public.home_list_items
  ADD COLUMN recurrence jsonb,
  ADD COLUMN series_id uuid,
  ADD COLUMN spawned_from uuid,
  ADD COLUMN auto_due_date date;

CREATE INDEX IF NOT EXISTS home_list_items_series_idx ON public.home_list_items(series_id) WHERE series_id IS NOT NULL;

-- rule: {unit:'day'|'weekday'|'week'|'month'|'year', interval:int, days?:int[] (0=Sun), from:'due'|'completion'}
CREATE OR REPLACE FUNCTION public.todo_step(_rule jsonb, _d date)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  u text := coalesce(_rule->>'unit', 'day');
  n int := greatest(1, coalesce((_rule->>'interval')::int, 1));
  r date; i int;
BEGIN
  IF u = 'weekday' THEN
    r := _d + 1;
    WHILE extract(dow FROM r) IN (0, 6) LOOP r := r + 1; END LOOP;
    RETURN r;
  ELSIF u = 'week' THEN
    IF n = 1 AND jsonb_typeof(_rule->'days') = 'array' AND jsonb_array_length(_rule->'days') > 0 THEN
      FOR i IN 1..7 LOOP
        r := _d + i;
        IF (_rule->'days') @> to_jsonb(extract(dow FROM r)::int) THEN RETURN r; END IF;
      END LOOP;
    END IF;
    RETURN _d + 7 * n;
  ELSIF u = 'month' THEN RETURN (_d + make_interval(months => n))::date;
  ELSIF u = 'year' THEN RETURN (_d + make_interval(years => n))::date;
  END IF;
  RETURN _d + n;
END $$;

CREATE OR REPLACE FUNCTION public.todo_recurrence_handler()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  today date := (now() AT TIME ZONE 'America/New_York')::date;
  nxt date; guard int := 0;
BEGIN
  IF NEW.list_type <> 'todo' THEN RETURN NEW; END IF;
  IF NEW.recurrence IS NOT NULL AND NEW.series_id IS NULL THEN NEW.series_id := NEW.id; END IF;

  IF TG_OP = 'UPDATE' AND NEW.recurrence IS NOT NULL AND NEW.due_date IS NOT NULL
     AND NEW.completed AND NOT OLD.completed THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.series_id::text));
    IF NOT EXISTS (SELECT 1 FROM public.home_list_items WHERE series_id = NEW.series_id AND id <> NEW.id AND completed = false)
       AND NOT EXISTS (SELECT 1 FROM public.home_list_items WHERE spawned_from = NEW.id) THEN
      IF NEW.recurrence->>'from' = 'completion' THEN
        nxt := public.todo_step(NEW.recurrence, today);
      ELSE
        nxt := public.todo_step(NEW.recurrence, NEW.due_date);
        WHILE nxt <= today AND guard < 2000 LOOP nxt := public.todo_step(NEW.recurrence, nxt); guard := guard + 1; END LOOP;
      END IF;
      INSERT INTO public.home_list_items (household_id, list_type, user_id, text, created_by, due_date, due_time, notes, recurrence, series_id, spawned_from, auto_due_date)
      VALUES (NEW.household_id, 'todo', NEW.user_id, NEW.text, coalesce(auth.uid(), NEW.created_by), nxt, NEW.due_time, NEW.notes, NEW.recurrence, NEW.series_id, NEW.id, nxt);
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.completed AND NOT NEW.completed AND NEW.series_id IS NOT NULL THEN
    DELETE FROM public.home_list_items c
     WHERE c.spawned_from = NEW.id AND c.completed = false
       AND c.created_at > now() - interval '1 hour'
       AND c.text = NEW.text AND c.user_id IS NOT DISTINCT FROM NEW.user_id
       AND c.due_date IS NOT DISTINCT FROM c.auto_due_date
       AND c.due_time IS NOT DISTINCT FROM NEW.due_time
       AND c.notes IS NOT DISTINCT FROM NEW.notes
       AND c.recurrence IS NOT DISTINCT FROM NEW.recurrence;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER home_list_items_recurrence
BEFORE INSERT OR UPDATE ON public.home_list_items
FOR EACH ROW EXECUTE FUNCTION public.todo_recurrence_handler();