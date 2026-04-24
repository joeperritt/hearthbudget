CREATE OR REPLACE FUNCTION public.recent_failed_mfa_attempts(
  _user_id uuid,
  _window_minutes integer DEFAULT 15,
  _attempt_type public.mfa_attempt_type DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::int
  FROM public.mfa_attempt_log
  WHERE user_id = _user_id
    AND success = false
    AND created_at > now() - make_interval(mins => _window_minutes)
    AND (_attempt_type IS NULL OR attempt_type = _attempt_type)
$function$;