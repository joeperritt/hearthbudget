-- Create secure plaid_tokens table accessible only by service role
CREATE TABLE public.plaid_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plaid_item_id UUID NOT NULL UNIQUE REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS but add NO policies — only service role can access
ALTER TABLE public.plaid_tokens ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at
CREATE TRIGGER update_plaid_tokens_updated_at
BEFORE UPDATE ON public.plaid_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Migrate existing tokens from plaid_items into plaid_tokens
INSERT INTO public.plaid_tokens (plaid_item_id, access_token)
SELECT id, access_token
FROM public.plaid_items
WHERE access_token IS NOT NULL AND access_token <> '';

-- Make access_token nullable on plaid_items (we'll null it out)
ALTER TABLE public.plaid_items ALTER COLUMN access_token DROP NOT NULL;

-- Wipe legacy tokens from plaid_items so they're no longer exposed via RLS
UPDATE public.plaid_items SET access_token = NULL;

COMMENT ON COLUMN public.plaid_items.access_token IS 'DEPRECATED: tokens moved to plaid_tokens table (service-role only). This column will be dropped in a future migration.';