
-- ============================================================
-- HARDENING C: Cierre de bot_settings público + service_role estricto
-- ============================================================

-- 1) Quitar acceso público anónimo a bot_settings
DROP POLICY IF EXISTS "Anyone can view bot_settings for active workshops" ON public.bot_settings;

-- 2) RPC pública que expone SOLO servicios (usada por el fallback de BookingPage)
CREATE OR REPLACE FUNCTION public.get_public_bot_services(_workshop_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(bs.services_json, '[]'::jsonb)
  FROM public.bot_settings bs
  WHERE bs.workshop_id = _workshop_id
    AND public.is_workshop_active(_workshop_id)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_bot_services(uuid) TO anon, authenticated;

-- 3) RPC pública mínima de configuración del bot (tono + descripción) por si se necesita en el futuro
CREATE OR REPLACE FUNCTION public.get_public_bot_config(_workshop_id uuid)
RETURNS TABLE(tone text, business_description text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bs.tone, bs.business_description
  FROM public.bot_settings bs
  WHERE bs.workshop_id = _workshop_id
    AND public.is_workshop_active(_workshop_id)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_bot_config(uuid) TO anon, authenticated;

-- ============================================================
-- 4) Reemplazar políticas USING(true) por chequeo explícito de service_role
-- ============================================================

-- appointment_actions
DROP POLICY IF EXISTS "Service role can manage appointment_actions" ON public.appointment_actions;
CREATE POLICY "Service role can manage appointment_actions"
ON public.appointment_actions
FOR ALL
USING (current_setting('role', true) = 'service_role')
WITH CHECK (current_setting('role', true) = 'service_role');

-- internal_notification_logs
DROP POLICY IF EXISTS "Service role can manage internal_notification_logs" ON public.internal_notification_logs;
CREATE POLICY "Service role can manage internal_notification_logs"
ON public.internal_notification_logs
FOR ALL
USING (current_setting('role', true) = 'service_role')
WITH CHECK (current_setting('role', true) = 'service_role');

-- message_batches
DROP POLICY IF EXISTS "Service role can manage batches" ON public.message_batches;
CREATE POLICY "Service role can manage batches"
ON public.message_batches
FOR ALL
USING (current_setting('role', true) = 'service_role')
WITH CHECK (current_setting('role', true) = 'service_role');

-- email_reminder_logs
DROP POLICY IF EXISTS "Service role can insert email_reminder_logs" ON public.email_reminder_logs;
CREATE POLICY "Service role can insert email_reminder_logs"
ON public.email_reminder_logs
FOR INSERT
WITH CHECK (current_setting('role', true) = 'service_role');

-- health_logs
DROP POLICY IF EXISTS "Service role can insert health_logs" ON public.health_logs;
CREATE POLICY "Service role can insert health_logs"
ON public.health_logs
FOR INSERT
WITH CHECK (current_setting('role', true) = 'service_role');

-- monthly_reports
DROP POLICY IF EXISTS "Service role can manage monthly_reports" ON public.monthly_reports;
CREATE POLICY "Service role can manage monthly_reports"
ON public.monthly_reports
FOR ALL
USING (current_setting('role', true) = 'service_role')
WITH CHECK (current_setting('role', true) = 'service_role');
