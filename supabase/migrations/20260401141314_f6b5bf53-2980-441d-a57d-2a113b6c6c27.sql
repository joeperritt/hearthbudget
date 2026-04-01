ALTER TABLE public.budget_categories ADD COLUMN notes_required boolean NOT NULL DEFAULT false;

-- Set existing categories that historically required notes
UPDATE public.budget_categories SET notes_required = true WHERE slug IN ('random', 'gifts', 'hosting-gifts');