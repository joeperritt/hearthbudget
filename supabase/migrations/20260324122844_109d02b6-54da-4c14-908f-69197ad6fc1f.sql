CREATE POLICY "Household members can update transactions"
ON public.transactions
FOR UPDATE
TO authenticated
USING (household_id = get_household_id())
WITH CHECK (household_id = get_household_id());