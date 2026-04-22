-- =====================================================
-- Role model overhaul: scoped roles + system admin
-- =====================================================

-- 1. Add new enum values (keep old ones for now to allow staged transition)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'system_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'household_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'household_member';
