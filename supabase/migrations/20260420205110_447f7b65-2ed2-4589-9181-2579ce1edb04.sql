-- Enable scheduling extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Add sync tracking columns to plaid_items
ALTER TABLE public.plaid_items
  ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS requires_reconnect boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_failure_count integer NOT NULL DEFAULT 0;