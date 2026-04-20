-- Enable full row replica identity so DELETE events can be filtered by household_id
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
ALTER TABLE public.budget_transfers REPLICA IDENTITY FULL;