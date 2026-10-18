CREATE OR REPLACE FUNCTION public.snooze_todo_reminder(_todo_id uuid, _action text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE fire_at timestamptz;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
 IF _action = 'hour' THEN fire_at := now() + interval '1 hour';
 ELSIF _action = 'tomorrow' THEN fire_at := ((now() AT TIME ZONE 'America/New_York') + interval '1 day') AT TIME ZONE 'America/New_York';
 ELSE RAISE EXCEPTION 'Invalid snooze action'; END IF;
 UPDATE public.todo_reminders r SET remind_at = fire_at, sent_at = NULL
 WHERE r.todo_id = _todo_id AND r.user_id = auth.uid()
 AND EXISTS (SELECT 1 FROM public.home_list_items i WHERE i.id = r.todo_id AND NOT i.completed);
 IF NOT FOUND THEN RAISE EXCEPTION 'This reminder is no longer available'; END IF;
 RETURN fire_at;
END $$;
REVOKE ALL ON FUNCTION public.snooze_todo_reminder(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snooze_todo_reminder(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.todo_reminder_handler()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF NEW.completed AND NOT OLD.completed THEN
   DELETE FROM public.todo_reminders WHERE todo_id = NEW.id;
  ELSIF NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.due_time IS DISTINCT FROM OLD.due_time THEN
   IF NEW.due_date IS NULL OR NEW.due_time IS NULL THEN
    DELETE FROM public.todo_reminders WHERE todo_id = NEW.id;
   ELSE
    UPDATE public.todo_reminders r SET remind_at = public.compute_remind_at(r.rule, NEW.due_date, NEW.due_time),
      sent_at = CASE WHEN public.compute_remind_at(r.rule, NEW.due_date, NEW.due_time) > now() THEN NULL ELSE r.sent_at END
    WHERE r.todo_id = NEW.id;
   END IF;
  END IF;
 ELSIF TG_OP = 'INSERT' AND NEW.spawned_from IS NOT NULL AND NEW.due_date IS NOT NULL AND NEW.due_time IS NOT NULL THEN
  INSERT INTO public.todo_reminders(todo_id,user_id,rule,remind_at)
   SELECT NEW.id,r.user_id,r.rule,public.compute_remind_at(r.rule,NEW.due_date,NEW.due_time)
   FROM public.todo_reminders r WHERE r.todo_id = NEW.spawned_from
   AND public.compute_remind_at(r.rule,NEW.due_date,NEW.due_time) IS NOT NULL;
 END IF;
 RETURN NEW;
END $$;