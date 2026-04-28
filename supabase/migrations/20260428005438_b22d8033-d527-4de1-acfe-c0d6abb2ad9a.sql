-- Drop the old merchant cache table (no longer used)
DROP TABLE IF EXISTS public.merchant_bucket_cache;

-- Create the category-to-bucket mapping table
CREATE TABLE public.category_bucket_map (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL,
  category_slug TEXT NOT NULL,
  category_kind TEXT NOT NULL DEFAULT 'variable', -- 'variable' | 'fixed'
  bucket_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- One bucket per category per household
CREATE UNIQUE INDEX category_bucket_map_household_category_uniq
  ON public.category_bucket_map (household_id, category_slug);

CREATE INDEX category_bucket_map_household_idx
  ON public.category_bucket_map (household_id);

-- Enable RLS
ALTER TABLE public.category_bucket_map ENABLE ROW LEVEL SECURITY;

-- Policies: household members manage their own mappings
CREATE POLICY "Household members view category bucket map"
  ON public.category_bucket_map
  FOR SELECT
  TO authenticated
  USING (household_id = get_household_id());

CREATE POLICY "Household members insert category bucket map"
  ON public.category_bucket_map
  FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_household_id());

CREATE POLICY "Household members update category bucket map"
  ON public.category_bucket_map
  FOR UPDATE
  TO authenticated
  USING (household_id = get_household_id())
  WITH CHECK (household_id = get_household_id());

CREATE POLICY "Household members delete category bucket map"
  ON public.category_bucket_map
  FOR DELETE
  TO authenticated
  USING (household_id = get_household_id());

-- Auto-update updated_at
CREATE TRIGGER update_category_bucket_map_updated_at
  BEFORE UPDATE ON public.category_bucket_map
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();