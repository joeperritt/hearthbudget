UPDATE public.ai_insights_cache SET month = '' WHERE month IS NULL;
ALTER TABLE public.ai_insights_cache ALTER COLUMN month SET NOT NULL;
ALTER TABLE public.ai_insights_cache ALTER COLUMN month SET DEFAULT '';
DROP INDEX IF EXISTS public.ai_insights_cache_household_kind_month_key;
ALTER TABLE public.ai_insights_cache ADD CONSTRAINT ai_insights_cache_household_kind_month_key UNIQUE (household_id, kind, month);