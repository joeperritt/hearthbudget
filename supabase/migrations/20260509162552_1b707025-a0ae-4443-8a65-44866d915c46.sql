ALTER TABLE public.ai_insights_cache ADD COLUMN IF NOT EXISTS month text;
ALTER TABLE public.ai_insights_cache DROP CONSTRAINT IF EXISTS ai_insights_cache_household_id_kind_key;
DELETE FROM public.ai_insights_cache a USING public.ai_insights_cache b
  WHERE a.household_id = b.household_id AND a.kind = b.kind AND COALESCE(a.month,'') = COALESCE(b.month,'') AND a.ctid < b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS ai_insights_cache_household_kind_month_key
  ON public.ai_insights_cache (household_id, kind, COALESCE(month, ''));