
-- 1. Extend enums
ALTER TYPE public.mfa_attempt_type ADD VALUE IF NOT EXISTS 'email_code';
ALTER TYPE public.mfa_audit_event ADD VALUE IF NOT EXISTS 'email_enroll_started';
ALTER TYPE public.mfa_audit_event ADD VALUE IF NOT EXISTS 'email_enroll_verified';
ALTER TYPE public.mfa_audit_event ADD VALUE IF NOT EXISTS 'email_enroll_failed';
ALTER TYPE public.mfa_audit_event ADD VALUE IF NOT EXISTS 'email_disabled';
ALTER TYPE public.mfa_audit_event ADD VALUE IF NOT EXISTS 'method_pref_changed';
ALTER TYPE public.mfa_audit_event ADD VALUE IF NOT EXISTS 'trusted_devices_revoked';

-- 2. mfa_email_codes — pending one-time codes
CREATE TABLE public.mfa_email_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code_hash text NOT NULL,
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('enroll','login','disable','step_up')),
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address text
);
CREATE INDEX idx_mfa_email_codes_user_purpose ON public.mfa_email_codes(user_id, purpose, expires_at DESC);
ALTER TABLE public.mfa_email_codes ENABLE ROW LEVEL SECURITY;
-- No user-facing policies; only service role accesses (via edge functions).

-- 3. user_mfa_email_factors — enrollment state, snapshotted email
CREATE TABLE public.user_mfa_email_factors (
  user_id uuid PRIMARY KEY,
  verified_email text NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_mfa_email_factors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own email factor"
  ON public.user_mfa_email_factors FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE TRIGGER trg_user_mfa_email_factors_updated
  BEFORE UPDATE ON public.user_mfa_email_factors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. user_mfa_method_pref — last used / preferred method
CREATE TABLE public.user_mfa_method_pref (
  user_id uuid PRIMARY KEY,
  last_used_method text CHECK (last_used_method IN ('totp','email')),
  preferred_method text CHECK (preferred_method IN ('totp','email')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_mfa_method_pref ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own method pref"
  ON public.user_mfa_method_pref FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Users upsert own method pref"
  ON public.user_mfa_method_pref FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own method pref"
  ON public.user_mfa_method_pref FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_user_mfa_method_pref_updated
  BEFORE UPDATE ON public.user_mfa_method_pref
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Centralized helper: revoke all trusted devices for a user.
CREATE OR REPLACE FUNCTION public.revoke_all_trusted_devices(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.mfa_trusted_devices
     SET revoked_at = now()
   WHERE user_id = _user_id
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_all_trusted_devices(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_all_trusted_devices(uuid) TO service_role;
