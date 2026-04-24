CREATE TABLE public.ai_insights_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('home', 'big_picture')),
  insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (household_id, kind)
);

ALTER TABLE public.ai_insights_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view ai insights cache"
  ON public.ai_insights_cache
  FOR SELECT
  TO authenticated
  USING (household_id = public.get_household_id());

CREATE TRIGGER update_ai_insights_cache_updated_at
  BEFORE UPDATE ON public.ai_insights_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_ai_insights_cache_household_kind ON public.ai_insights_cache(household_id, kind);