-- Apply after M3 and after gmail-disconnect stops writing this column.
ALTER TABLE public.workshops DROP COLUMN IF EXISTS gmail_refresh_token;

-- Explicit call in case the event trigger could not be created.
SELECT public.apply_safe_column_grants('workshops') AS workshops_credential_columns;
