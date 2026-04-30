CREATE TABLE public.mfa_trusted_devices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_mfa_trusted_devices_user ON public.mfa_trusted_devices(user_id);
CREATE INDEX idx_mfa_trusted_devices_token ON public.mfa_trusted_devices(token_hash);

ALTER TABLE public.mfa_trusted_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own trusted devices"
  ON public.mfa_trusted_devices FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can revoke (update) their own trusted devices"
  ON public.mfa_trusted_devices FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own trusted devices"
  ON public.mfa_trusted_devices FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
-- Inserts are done by edge functions using the service role; no client insert policy.