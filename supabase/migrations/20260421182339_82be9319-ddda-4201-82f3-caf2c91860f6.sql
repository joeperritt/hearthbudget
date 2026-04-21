
-- App-wide config (single row)
CREATE TABLE public.app_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  signup_mode TEXT NOT NULL DEFAULT 'invite_only' CHECK (signup_mode IN ('admin_only', 'invite_only', 'open')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
INSERT INTO public.app_config (id, signup_mode) VALUES (1, 'invite_only');

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. anon) can read signup mode — needed for /signup gating before auth
CREATE POLICY "Anyone can read app_config"
  ON public.app_config FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can update app_config"
  ON public.app_config FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Invites
CREATE TABLE public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  email TEXT,
  created_by UUID NOT NULL,
  household_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  used_by UUID,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_invites_code ON public.invites(code);
CREATE INDEX idx_invites_created_by ON public.invites(created_by);

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Admins can manage invites in their own household scope
CREATE POLICY "Admins can view invites they created"
  ON public.invites FOR SELECT
  TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create invites"
  ON public.invites FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND created_by = auth.uid());

CREATE POLICY "Admins can update their invites"
  ON public.invites FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() AND public.has_role(auth.uid(), 'admin'));

-- Public function to validate an invite code (no PII leak — returns boolean + minimal info)
CREATE OR REPLACE FUNCTION public.validate_invite_code(_code TEXT, _email TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invites%ROWTYPE;
BEGIN
  SELECT * INTO v_invite FROM public.invites WHERE code = _code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
  END IF;

  IF v_invite.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'used');
  END IF;

  IF v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;

  IF v_invite.email IS NOT NULL AND _email IS NOT NULL AND lower(v_invite.email) != lower(_email) THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'email_mismatch');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'invite_id', v_invite.id,
    'email_locked', v_invite.email IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_invite_code(TEXT, TEXT) TO anon, authenticated;

-- Trigger to maintain updated_at on app_config
CREATE TRIGGER app_config_updated_at
  BEFORE UPDATE ON public.app_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill: ensure existing users (Joe, Katie) are marked email-confirmed
UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, created_at, now())
WHERE email_confirmed_at IS NULL;
