CREATE OR REPLACE FUNCTION public.todo_reminders_due(_at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.todo_reminders r
    JOIN public.home_list_items i ON i.id = r.todo_id
    LEFT JOIN public.notification_prefs p ON p.user_id = r.user_id
    WHERE r.sent_at IS NULL AND r.remind_at <= _at
      AND NOT i.completed
      AND coalesce(p.todo_reminders_enabled, true)
  );
$$;
REVOKE ALL ON FUNCTION public.todo_reminders_due(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.todo_reminders_due(timestamptz) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.morning_summary_due(_at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notification_prefs p
    WHERE p.morning_enabled
      AND p.last_sent_date IS DISTINCT FROM (_at AT TIME ZONE 'America/New_York')::date
      AND to_char(p.morning_time, 'HH24:MI') <= to_char(_at AT TIME ZONE 'America/New_York', 'HH24:MI')
      AND (_at AT TIME ZONE 'America/New_York')::time < time '12:00'
  );
$$;
REVOKE ALL ON FUNCTION public.morning_summary_due(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.morning_summary_due(timestamptz) TO postgres, service_role;

CREATE INDEX IF NOT EXISTS notification_prefs_morning_due_idx ON public.notification_prefs (morning_time) WHERE morning_enabled;
COMMENT ON FUNCTION public.todo_reminders_due(timestamptz) IS 'Cron eligibility, matching reminder sender including missing preferences defaulting to enabled. Optional clock supports deterministic tests.';
COMMENT ON FUNCTION public.morning_summary_due(timestamptz) IS 'Cron eligibility, matching sender minute precision, Eastern calendar date and noon cutoff. Optional clock supports deterministic tests.';