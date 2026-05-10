-- Fix mutable search_path on pgmq wrapper functions
ALTER FUNCTION public.enqueue_email(text, jsonb)        SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint)        SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb)   SET search_path = public, pgmq;

-- Revoke EXECUTE from anon on internal helpers (do NOT revoke from authenticated — needed for RLS)
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recent_failed_mfa_attempts(uuid, integer, public.mfa_attempt_type) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_all_trusted_devices(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_system_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_household_admin(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_current_household_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_household_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_email_confirmed() FROM anon, authenticated;