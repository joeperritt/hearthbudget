-- ============================================================
-- Phase 4C: MFA / 2FA support tables
-- ============================================================
-- 1. Recovery codes (10 per user, hashed, single-use)
-- 2. Audit log (every enroll / verify / disable / recovery use / regenerate)
-- 3. Attempt log (for 5-strikes / 15-min lockout)
-- ============================================================

-- ---------- user_mfa_recovery_codes ----------
CREATE TABLE public.user_mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code_hash text NOT NULL,           -- bcrypt-style hash of the plaintext code
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfa_recovery_codes_user ON public.user_mfa_recovery_codes(user_id) WHERE consumed_at IS NULL;

ALTER TABLE public.user_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

-- Users can see (existence/consumed status) of their own codes — never the hash in practice
-- but RLS doesn't column-filter, so we expose the row. The hash alone is useless.
CREATE POLICY "Users view own recovery codes"
  ON public.user_mfa_recovery_codes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Inserts/updates/deletes happen ONLY via service-role edge functions.
-- No INSERT/UPDATE/DELETE policies for authenticated → blocked by default.

-- ---------- mfa_audit_log ----------
CREATE TYPE public.mfa_audit_event AS ENUM (
  'enroll_started',
  'enroll_verified',
  'enroll_failed',
  'verify_success',
  'verify_failed',
  'disabled',
  'recovery_code_used',
  'recovery_codes_regenerated'
);

CREATE TABLE public.mfa_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event public.mfa_audit_event NOT NULL,
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfa_audit_user_created ON public.mfa_audit_log(user_id, created_at DESC);

ALTER TABLE public.mfa_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own audit log"
  ON public.mfa_audit_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System admins view all audit log"
  ON public.mfa_audit_log
  FOR SELECT TO authenticated
  USING (public.is_system_admin(auth.uid()));

-- Inserts only via service-role edge functions.

-- ---------- mfa_attempt_log ----------
-- Row per failed attempt; success rows clear via consumed_at semantics not needed —
-- we only care about failure counts within a window.
CREATE TABLE public.mfa_attempt_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  attempt_type text NOT NULL CHECK (attempt_type IN ('totp', 'recovery_code')),
  success boolean NOT NULL,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfa_attempt_user_created ON public.mfa_attempt_log(user_id, created_at DESC);

ALTER TABLE public.mfa_attempt_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own attempts"
  ON public.mfa_attempt_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Inserts only via service-role edge functions.

-- ---------- helper: count recent failures ----------
CREATE OR REPLACE FUNCTION public.recent_failed_mfa_attempts(_user_id uuid, _window_minutes int DEFAULT 15)
RETURNS int
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.mfa_attempt_log
  WHERE user_id = _user_id
    AND success = false
    AND created_at > now() - make_interval(mins => _window_minutes)
$$;
