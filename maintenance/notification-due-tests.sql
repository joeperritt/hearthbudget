-- Run through the database write tool. All fixtures roll back; no HTTP calls.
BEGIN;
DO $tests$
DECLARE
  test_user uuid := 'a72077a2-315f-4f90-883d-531d130c5c35';
  test_item uuid := 'a72077a2-315f-4f90-883d-531d130c5c36';
  hh uuid;
  clock timestamptz := '1900-01-01 11:59:00 America/New_York';
BEGIN
  SELECT household_id INTO STRICT hh FROM public.profiles
    WHERE user_id = '13efdfc1-d276-4a93-b4ff-9f238d5f4793';
  INSERT INTO public.home_list_items (id, household_id, list_type, text, user_id, created_by)
    VALUES (test_item, hh, 'todo', 'Disposable eligibility test', test_user, test_user);
  INSERT INTO public.todo_reminders (todo_id, user_id, rule, remind_at)
    VALUES (test_item, test_user, '{"kind":"at"}', clock + interval '1 minute');
  ASSERT NOT public.todo_reminders_due(clock), 'Future reminder must not be due';
  ASSERT public.todo_reminders_due(clock + interval '1 minute'), 'Reminder must become due at one minute; missing prefs default on';
  INSERT INTO public.notification_prefs (user_id, todo_reminders_enabled, morning_enabled, morning_time)
    VALUES (test_user, false, true, '11:59:45');
  ASSERT NOT public.todo_reminders_due(clock + interval '1 minute'), 'Disabled reminder preference must suppress dispatch';
  UPDATE public.notification_prefs SET todo_reminders_enabled = true WHERE user_id = test_user;
  UPDATE public.home_list_items SET completed = true WHERE id = test_item;
  ASSERT NOT public.todo_reminders_due(clock + interval '1 minute'), 'Completed todo must not dispatch';
  UPDATE public.home_list_items SET completed = false WHERE id = test_item;
  UPDATE public.todo_reminders SET sent_at = clock WHERE todo_id = test_item;
  ASSERT NOT public.todo_reminders_due(clock + interval '1 minute'), 'Sent reminder must not dispatch';
  UPDATE public.todo_reminders SET sent_at = null WHERE todo_id = test_item;
  DELETE FROM public.home_list_items WHERE id = test_item;
  ASSERT NOT public.todo_reminders_due(clock + interval '1 minute'), 'Deleted todo must not dispatch';
  ASSERT public.morning_summary_due(clock), 'Due summary matches sender minute precision even with seconds in preference';
  ASSERT NOT public.morning_summary_due(clock - interval '1 minute'), 'Future morning time must not dispatch';
  ASSERT NOT public.morning_summary_due(clock + interval '1 minute'), 'Noon cutoff must suppress dispatch';
  UPDATE public.notification_prefs SET last_sent_date = '1900-01-01' WHERE user_id = test_user;
  ASSERT NOT public.morning_summary_due(clock), 'Already-sent Eastern date must suppress dispatch';
  UPDATE public.notification_prefs SET last_sent_date = '1899-12-31' WHERE user_id = test_user;
  ASSERT public.morning_summary_due(clock), 'Previous Eastern date must allow dispatch';
  UPDATE public.notification_prefs SET morning_enabled = false WHERE user_id = test_user;
  ASSERT NOT public.morning_summary_due(clock), 'Disabled morning summary must not dispatch';
END
$tests$;
ROLLBACK;