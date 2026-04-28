-- Merchant → CFP bucket cache. Scoped per-household for v1; the
-- `is_global_candidate` + nullable household_id design lets us add an
-- anonymized global tier later without a schema migration.
CREATE TABLE public.merchant_bucket_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NULL,                    -- NULL = global (future); NOT NULL for v1
  merchant_normalized TEXT NOT NULL,         -- lowercased, punctuation-stripped
  merchant_display TEXT NOT NULL,            -- human-readable original
  bucket_key TEXT NOT NULL,                  -- single-bucket assignment
  split JSONB NOT NULL DEFAULT '[]'::jsonb,  -- optional [{ bucket_key, pct }] for multi-bucket merchants (e.g. Costco)
  source TEXT NOT NULL DEFAULT 'ai',         -- 'ai' | 'user'
  confidence TEXT NOT NULL DEFAULT 'medium', -- 'low' | 'medium' | 'high'
  is_global_candidate BOOLEAN NOT NULL DEFAULT false, -- forward-compat flag
  sample_count INTEGER NOT NULL DEFAULT 0,   -- how many txns informed this assignment
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One assignment per (household, merchant). For future global rows household_id IS NULL.
CREATE UNIQUE INDEX merchant_bucket_cache_household_merchant_uniq
  ON public.merchant_bucket_cache (household_id, merchant_normalized)
  WHERE household_id IS NOT NULL;

CREATE UNIQUE INDEX merchant_bucket_cache_global_merchant_uniq
  ON public.merchant_bucket_cache (merchant_normalized)
  WHERE household_id IS NULL;

CREATE INDEX merchant_bucket_cache_household_idx
  ON public.merchant_bucket_cache (household_id);

ALTER TABLE public.merchant_bucket_cache ENABLE ROW LEVEL SECURITY;

-- Household members can view their own cache + any future global rows
CREATE POLICY "Household members view merchant cache"
ON public.merchant_bucket_cache
FOR SELECT
TO authenticated
USING (household_id = public.get_household_id() OR household_id IS NULL);

CREATE POLICY "Household members insert merchant cache"
ON public.merchant_bucket_cache
FOR INSERT
TO authenticated
WITH CHECK (household_id = public.get_household_id());

CREATE POLICY "Household members update merchant cache"
ON public.merchant_bucket_cache
FOR UPDATE
TO authenticated
USING (household_id = public.get_household_id())
WITH CHECK (household_id = public.get_household_id());

CREATE POLICY "Household members delete merchant cache"
ON public.merchant_bucket_cache
FOR DELETE
TO authenticated
USING (household_id = public.get_household_id());

CREATE TRIGGER update_merchant_bucket_cache_updated_at
BEFORE UPDATE ON public.merchant_bucket_cache
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();