-- Additive step: safe read paths that work both before and after credential
-- columns are revoked from end-user roles.

CREATE OR REPLACE FUNCTION public.is_credential_column(_column_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _column_name ~* '(token|secret|password|api_key|private_key)'
$$;

-- workshops_safe exposes every non-credential column, so it stays complete when
-- columns are added to workshops.
CREATE OR REPLACE FUNCTION public.rebuild_workshops_safe_view()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  safe_columns text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO safe_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'workshops'
    AND NOT public.is_credential_column(column_name);

  EXECUTE 'DROP VIEW IF EXISTS public.workshops_safe';
  EXECUTE format(
    'CREATE VIEW public.workshops_safe WITH (security_invoker = true) AS SELECT %s FROM public.workshops',
    safe_columns
  );
  EXECUTE 'REVOKE ALL ON public.workshops_safe FROM anon';
  EXECUTE 'GRANT SELECT ON public.workshops_safe TO authenticated';
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_workshops_safe_view() FROM PUBLIC, anon, authenticated;

SELECT public.rebuild_workshops_safe_view();

CREATE OR REPLACE FUNCTION public.get_workshop_credential_status(_workshop_id uuid)
RETURNS TABLE(whatsapp_token_configured boolean, instagram_token_configured boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce(w.whatsapp_access_token, '') <> '',
    coalesce(w.instagram_access_token, '') <> ''
  FROM public.workshops w
  WHERE w.id = _workshop_id
    AND (
      public.is_superadmin(auth.uid())
      OR (
        public.has_role(auth.uid(), 'ADMIN'::app_role)
        AND public.get_user_workshop_id(auth.uid()) = _workshop_id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_workshop_credential_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workshop_credential_status(uuid) TO authenticated;

-- Gmail tokens live in workshop_gmail_tokens; the legacy workshops.gmail_refresh_token
-- column is never written, so a connected workshop was reported as 'error'.
CREATE OR REPLACE FUNCTION public.get_workshop_health_status(p_workshop_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  error_count_24h INTEGER;
  last_inbound TIMESTAMPTZ;
  last_outbound TIMESTAMPTZ;
  gmail_status TEXT;
  whatsapp_status BOOLEAN;
  bot_paused_count INTEGER;
BEGIN
  IF auth.role() IS NOT NULL
     AND auth.role() <> 'service_role'
     AND NOT public.is_superadmin(auth.uid())
     AND public.get_user_workshop_id(auth.uid()) IS DISTINCT FROM p_workshop_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO error_count_24h
  FROM health_logs
  WHERE workshop_id = p_workshop_id
    AND event_type = 'error'
    AND created_at >= NOW() - INTERVAL '24 hours';

  SELECT MAX(created_at) INTO last_inbound
  FROM messages
  WHERE workshop_id = p_workshop_id AND direction = 'inbound';

  SELECT MAX(created_at) INTO last_outbound
  FROM messages
  WHERE workshop_id = p_workshop_id AND direction = 'outbound';

  SELECT
    CASE
      WHEN w.gmail_connected = true
        AND EXISTS (SELECT 1 FROM workshop_gmail_tokens t WHERE t.workshop_id = w.id) THEN 'connected'
      WHEN w.gmail_connected = true THEN 'error'
      ELSE 'disconnected'
    END INTO gmail_status
  FROM workshops w WHERE w.id = p_workshop_id;

  SELECT whatsapp_connected INTO whatsapp_status
  FROM workshops WHERE id = p_workshop_id;

  SELECT COUNT(*) INTO bot_paused_count
  FROM conversations
  WHERE workshop_id = p_workshop_id AND bot_paused = true;

  result := json_build_object(
    'gmail_status', COALESCE(gmail_status, 'disconnected'),
    'whatsapp_connected', COALESCE(whatsapp_status, false),
    'last_inbound', last_inbound,
    'last_outbound', last_outbound,
    'errors_24h', error_count_24h,
    'bot_paused_count', bot_paused_count,
    'overall_status', CASE
      WHEN error_count_24h >= 5 THEN 'critical'
      WHEN last_inbound < NOW() - INTERVAL '12 hours' AND last_inbound IS NOT NULL THEN 'warning'
      WHEN gmail_status = 'error' THEN 'warning'
      ELSE 'healthy'
    END
  );

  RETURN result;
END;
$$;
