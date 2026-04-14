ALTER TABLE public.budget_categories ADD COLUMN start_month text;
ALTER TABLE public.budget_categories ADD COLUMN end_month text;

ALTER TABLE public.fixed_expenses ADD COLUMN start_month text;
ALTER TABLE public.fixed_expenses ADD COLUMN end_month text;