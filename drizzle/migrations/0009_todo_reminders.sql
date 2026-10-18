-- lovable-cron-fallback-reviewed: reminders must fire at a specific minute chosen by the user; only a per-minute time-based check can deliver that, and runs are no-ops when nothing is due.
CREATE TABLE public.todo_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id uuid NOT NULL REFERENCES public.home_list_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rule jsonb NOT NULL,
  remind_at timestamptz NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (todo_id, user_id)
);
CREATE INDEX todo_reminders_due_idx ON public.todo_reminders (remind_at) WHERE sent_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.todo_reminders TO authenticated;
GRANT ALL ON public.todo_reminders TO service_role;

ALTER TABLE public.todo_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own reminders" ON public.todo_reminders
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.notification_prefs ADD COLUMN todo_reminders_enabled boolean NOT NULL DEFAULT true;

-- Compute when a reminder fires from its rule and the to do's due date/time (America/New_York).
CREATE OR REPLACE FUNCTION public.compute_remind_at(_rule jsonb, _due_date date, _due_time time)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _rule->>'kind'
    WHEN 'at' THEN CASE WHEN _due_time IS NULL THEN NULL ELSE (_due_date + _due_time) AT TIME ZONE 'America/New_York' END
    WHEN 'before15' THEN CASE WHEN _due_time IS NULL THEN NULL ELSE (_due_date + _due_time) AT TIME ZONE 'America/New_York' - interval '15 minutes' END
    WHEN 'before1h' THEN CASE WHEN _due_time IS NULL THEN NULL ELSE (_due_date + _due_time) AT TIME ZONE 'America/New_York' - interval '1 hour' END
    WHEN 'morning_of' THEN (_due_date + time '08:00') AT TIME ZONE 'America/New_York'
    WHEN 'day_before' THEN ((_due_date - 1) + time '08:00') AT TIME ZONE 'America/New_York'
    WHEN 'custom' THEN NULLIF(_rule->>'custom_at', '')::timestamptz
  END
$$;

-- Keep reminders in step with the to do: recompute on due change, cancel on completion,
-- and copy each user's rule to the next instance of a recurring to do.
CREATE OR REPLACE FUNCTION public.todo_reminder_handler()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.completed AND NOT OLD.completed THEN
      DELETE FROM public.todo_reminders WHERE todo_id = NEW.id;
    ELSIF NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.due_time IS DISTINCT FROM OLD.due_time THEN
      IF NEW.due_date IS NULL THEN
        DELETE FROM public.todo_reminders WHERE todo_id = NEW.id;
      ELSE
        UPDATE public.todo_reminders r
           SET remind_at = public.compute_remind_at(r.rule, NEW.due_date, NEW.due_time),
               sent_at = CASE WHEN public.compute_remind_at(r.rule, NEW.due_date, NEW.due_time) > now() THEN NULL ELSE r.sent_at END
         WHERE r.todo_id = NEW.id;
        DELETE FROM public.todo_reminders WHERE todo_id = NEW.id AND remind_at IS NULL;
      END IF;
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.spawned_from IS NOT NULL AND NEW.due_date IS NOT NULL THEN
    INSERT INTO public.todo_reminders (todo_id, user_id, rule, remind_at)
    SELECT NEW.id, r.user_id, r.rule, public.compute_remind_at(r.rule, NEW.due_date, NEW.due_time)
      FROM public.todo_reminders r
     WHERE r.todo_id = NEW.spawned_from
       AND public.compute_remind_at(r.rule, NEW.due_date, NEW.due_time) IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER home_list_items_reminders
  AFTER INSERT OR UPDATE ON public.home_list_items
  FOR EACH ROW EXECUTE FUNCTION public.todo_reminder_handler();

-- Send due reminders every minute.
SELECT cron.schedule('todo-reminders', '* * * * *', $cron$
  SELECT net.http_post(
    url := 'https://ttwaapmtayrmwgerzqro.supabase.co/functions/v1/todo-reminders',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"mode":"scheduled"}'::jsonb
  );
$cron$);
