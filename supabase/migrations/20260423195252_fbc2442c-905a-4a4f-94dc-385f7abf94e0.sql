-- ============================================================
-- Phase 4C MFA tables — revisions
-- ============================================================
-- 1. Convert mfa_attempt_log.attempt_type to a proper enum
-- 2. Add system_admin SELECT policy to mfa_attempt_log
-- (No changes to user_mfa_recovery_codes or mfa_audit_log)
-- ============================================================

-- ---------- 1. enum-ify attempt_type ----------
CREATE TYPE public.mfa_attempt_type AS ENUM ('totp', 'recovery_code');

-- Drop the CHECK constraint, convert column type, then re-enforce NOT NULL implicitly
ALTER TABLE public.mfa_attempt_log
  DROP CONSTRAINT IF EXISTS mfa_attempt_log_attempt_type_check;

ALTER TABLE public.mfa_attempt_log
  ALTER COLUMN attempt_type TYPE public.mfa_attempt_type
  USING attempt_type::public.mfa_attempt_type;

-- ---------- 2. system_admin read on mfa_attempt_log ----------
CREATE POLICY "System admins view all attempts"
  ON public.mfa_attempt_log
  FOR SELECT TO authenticated
  USING (public.is_system_admin(auth.uid()));
