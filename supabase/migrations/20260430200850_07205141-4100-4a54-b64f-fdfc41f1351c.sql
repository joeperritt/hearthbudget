-- Replace insert policy on invites so only system admins can create
-- "new-household" invites (household_id IS NULL). Household admins can still
-- create "join my household" invites (household_id = their household).
DROP POLICY IF EXISTS "Household admins create invites" ON public.invites;

CREATE POLICY "Admins create invites"
ON public.invites
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    -- System admins can create any invite
    public.is_system_admin(auth.uid())
    -- Household admins can ONLY create invites that join their own household
    OR (
      household_id IS NOT NULL
      AND household_id = public.get_household_id()
      AND public.is_current_household_admin()
    )
  )
);