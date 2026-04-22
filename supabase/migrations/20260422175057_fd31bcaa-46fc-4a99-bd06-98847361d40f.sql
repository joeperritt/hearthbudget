-- =====================================================
-- 2. Add household_id column to user_roles
-- =====================================================
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS household_id uuid REFERENCES public.households(id) ON DELETE CASCADE;

-- 3. Drop existing unique constraint and add new one that allows multiple roles per user
-- (one per household + one system role)
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;

-- Unique on (user_id, role, household_id) — uses NULLS NOT DISTINCT so NULL household_id is treated as a single slot
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_unique_scope
  ON public.user_roles (user_id, role, COALESCE(household_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- =====================================================
-- 4. Backfill existing rows
-- =====================================================
-- Joe: existing 'admin' row → becomes system_admin (NULL household_id)
UPDATE public.user_roles
   SET role = 'system_admin', household_id = NULL
 WHERE user_id = '13efdfc1-d276-4a93-b4ff-9f238d5f4793' AND role = 'admin';

-- Joe: also add household_admin of Perritt Family
INSERT INTO public.user_roles (user_id, role, household_id)
VALUES ('13efdfc1-d276-4a93-b4ff-9f238d5f4793', 'household_admin', '6c4e60db-1b94-41a1-935c-91d851966a50')
ON CONFLICT DO NOTHING;

-- Katie: 'member' → household_member of Perritt Family
UPDATE public.user_roles
   SET role = 'household_member', household_id = '6c4e60db-1b94-41a1-935c-91d851966a50'
 WHERE user_id = '72e11e46-d6cb-42c2-b8eb-7e4dc82ec8eb' AND role = 'member';

-- Test user: was 'admin' globally (BUG). Demote: only household_admin of their own household.
DELETE FROM public.user_roles
 WHERE user_id = '5567c366-dc02-4b4b-865c-c6ec279074a1' AND role = 'admin';
INSERT INTO public.user_roles (user_id, role, household_id)
VALUES ('5567c366-dc02-4b4b-865c-c6ec279074a1', 'household_admin', 'de857cfe-4e15-4a30-82ac-1f37657988c7')
ON CONFLICT DO NOTHING;

-- =====================================================
-- 5. Helper functions
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_system_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'system_admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_household_admin(_user_id uuid, _household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'household_admin'
      AND household_id = _household_id
  )
$$;

-- Convenience: is current user admin of their own household?
CREATE OR REPLACE FUNCTION public.is_current_household_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_household_admin(auth.uid(), public.get_household_id())
$$;

-- =====================================================
-- 6. Update RLS policies that referenced has_role(uid, 'admin')
-- =====================================================

-- INVITES: scope SELECT to invites for the user's own household, and only if they are household_admin there.
-- System admins can see everything.
DROP POLICY IF EXISTS "Admins can view invites they created" ON public.invites;
CREATE POLICY "Household admins view their household invites"
  ON public.invites FOR SELECT
  TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR (
      created_by = auth.uid()
      AND public.is_current_household_admin()
    )
  );

DROP POLICY IF EXISTS "Admins can create invites" ON public.invites;
CREATE POLICY "Household admins create invites"
  ON public.invites FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_current_household_admin()
  );

DROP POLICY IF EXISTS "Admins can update their invites" ON public.invites;
CREATE POLICY "Household admins update their invites"
  ON public.invites FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    AND public.is_current_household_admin()
  );

-- PROFILES: only household admins (or system admins) can insert profiles.
-- This is mainly used by the signup edge function (service role bypasses RLS), but tighten anyway.
DROP POLICY IF EXISTS "Admin can insert profiles" ON public.profiles;
CREATE POLICY "Household admins or system admins insert profiles"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_system_admin(auth.uid())
    OR public.is_household_admin(auth.uid(), household_id)
  );

-- USER_ROLES: only system admins can manage roles (operator action).
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "System admins manage all roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));

-- APP_CONFIG: only system admins can update.
DROP POLICY IF EXISTS "Admins can update app_config" ON public.app_config;
CREATE POLICY "System admins update app_config"
  ON public.app_config FOR UPDATE
  TO authenticated
  USING (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));

-- =====================================================
-- 7. Cleanup orphan households (no profiles attached)
-- =====================================================
DELETE FROM public.budget_categories WHERE household_id IN (
  '6bf31722-0cf6-4c8f-8942-bfd2f366b44a',
  '77019fdc-519a-41f4-a150-cd687360a69e',
  'f17fc57a-053e-4f6e-bc71-5fa0c19a6ea3'
);
DELETE FROM public.fixed_expenses WHERE household_id IN (
  '6bf31722-0cf6-4c8f-8942-bfd2f366b44a',
  '77019fdc-519a-41f4-a150-cd687360a69e',
  'f17fc57a-053e-4f6e-bc71-5fa0c19a6ea3'
);
DELETE FROM public.households WHERE id IN (
  '6bf31722-0cf6-4c8f-8942-bfd2f366b44a',
  '77019fdc-519a-41f4-a150-cd687360a69e',
  'f17fc57a-053e-4f6e-bc71-5fa0c19a6ea3'
);

-- =====================================================
-- 8. Restore the 3 invite codes consumed by orphan signups
-- =====================================================
UPDATE public.invites
   SET used_at = NULL, used_by = NULL
 WHERE id IN (
   '15b18825-d540-4638-8622-03ec3e79537c',  -- V4PFZETH
   '2bd0672f-e34d-4c2d-9730-eba72585119a',  -- HTBLA2MB
   '42b3f987-aa44-4012-bd72-158325155fce'   -- 7KKYHNUT
 );
