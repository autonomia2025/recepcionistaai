-- ===================================
-- FASE 1: Health Check + Email Settings
-- ===================================

-- 1. Tabla para logs de salud del sistema
CREATE TABLE public.health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID REFERENCES public.workshops(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL, -- 'error', 'warning', 'info', 'email_sent', 'email_failed', 'reminder_sent', 'reminder_failed'
  category TEXT NOT NULL, -- 'gmail', 'whatsapp', 'instagram', 'bot', 'reminder', 'webchat'
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Índices para consultas frecuentes
CREATE INDEX idx_health_logs_workshop_created ON public.health_logs(workshop_id, created_at DESC);
CREATE INDEX idx_health_logs_event_type ON public.health_logs(event_type, created_at DESC);
CREATE INDEX idx_health_logs_category ON public.health_logs(category);

-- Enable RLS
ALTER TABLE public.health_logs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "SUPERADMIN can manage all health_logs"
  ON public.health_logs FOR ALL
  USING (is_superadmin(auth.uid()))
  WITH CHECK (is_superadmin(auth.uid()));

CREATE POLICY "ADMIN can view their workshop health_logs"
  ON public.health_logs FOR SELECT
  USING (workshop_id = get_user_workshop_id(auth.uid()));

CREATE POLICY "Service role can insert health_logs"
  ON public.health_logs FOR INSERT
  WITH CHECK (true);

-- 2. Agregar campos de email/Gmail a workshops
ALTER TABLE public.workshops
  ADD COLUMN IF NOT EXISTS gmail_connected BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gmail_email TEXT,
  ADD COLUMN IF NOT EXISTS gmail_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS gmail_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_sender_name TEXT,
  ADD COLUMN IF NOT EXISTS email_reminders_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_notifications_handoff BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_notifications_hot_lead BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_notifications_appointment BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_notification_email TEXT;

-- 3. Agregar campos de branding de email
ALTER TABLE public.workshops
  ADD COLUMN IF NOT EXISTS email_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS email_primary_color TEXT DEFAULT '#6366f1',
  ADD COLUMN IF NOT EXISTS email_button_color TEXT,
  ADD COLUMN IF NOT EXISTS email_use_branding BOOLEAN DEFAULT true;

-- 4. Tabla para tracking de recordatorios enviados (idempotencia)
CREATE TABLE public.email_reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID REFERENCES public.workshops(id) ON DELETE CASCADE NOT NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE NOT NULL,
  reminder_type TEXT NOT NULL, -- '24h', '3h', 'confirmation'
  sent_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  email_to TEXT NOT NULL,
  status TEXT DEFAULT 'sent', -- 'sent', 'failed', 'bounced'
  error_message TEXT,
  UNIQUE(appointment_id, reminder_type)
);

CREATE INDEX idx_email_reminder_logs_appointment ON public.email_reminder_logs(appointment_id);
CREATE INDEX idx_email_reminder_logs_workshop ON public.email_reminder_logs(workshop_id, sent_at DESC);

-- Enable RLS
ALTER TABLE public.email_reminder_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SUPERADMIN can manage all email_reminder_logs"
  ON public.email_reminder_logs FOR ALL
  USING (is_superadmin(auth.uid()))
  WITH CHECK (is_superadmin(auth.uid()));

CREATE POLICY "ADMIN can view their workshop email_reminder_logs"
  ON public.email_reminder_logs FOR SELECT
  USING (workshop_id = get_user_workshop_id(auth.uid()));

CREATE POLICY "Service role can insert email_reminder_logs"
  ON public.email_reminder_logs FOR INSERT
  WITH CHECK (true);

-- 5. Tabla para reportes mensuales
CREATE TABLE public.monthly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID REFERENCES public.workshops(id) ON DELETE CASCADE NOT NULL,
  report_month DATE NOT NULL, -- Primer día del mes
  conversations_count INTEGER DEFAULT 0,
  hot_leads_count INTEGER DEFAULT 0,
  handoffs_count INTEGER DEFAULT 0,
  appointments_count INTEGER DEFAULT 0,
  conversion_rate NUMERIC(5,2) DEFAULT 0,
  avg_response_time_minutes INTEGER,
  top_intents JSONB DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  emailed_at TIMESTAMPTZ,
  UNIQUE(workshop_id, report_month)
);

CREATE INDEX idx_monthly_reports_workshop ON public.monthly_reports(workshop_id, report_month DESC);

-- Enable RLS
ALTER TABLE public.monthly_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SUPERADMIN can manage all monthly_reports"
  ON public.monthly_reports FOR ALL
  USING (is_superadmin(auth.uid()))
  WITH CHECK (is_superadmin(auth.uid()));

CREATE POLICY "ADMIN can view their workshop monthly_reports"
  ON public.monthly_reports FOR SELECT
  USING (workshop_id = get_user_workshop_id(auth.uid()));

CREATE POLICY "Service role can manage monthly_reports"
  ON public.monthly_reports FOR ALL
  WITH CHECK (true);

-- 6. Agregar campo para recibir reporte mensual
ALTER TABLE public.workshops
  ADD COLUMN IF NOT EXISTS email_monthly_report BOOLEAN DEFAULT true;

-- 7. Función helper para obtener health status de un workshop
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
  -- Contar errores últimas 24h
  SELECT COUNT(*) INTO error_count_24h
  FROM health_logs
  WHERE workshop_id = p_workshop_id
    AND event_type = 'error'
    AND created_at >= NOW() - INTERVAL '24 hours';
  
  -- Último mensaje entrante
  SELECT MAX(created_at) INTO last_inbound
  FROM messages
  WHERE workshop_id = p_workshop_id AND direction = 'inbound';
  
  -- Último mensaje saliente
  SELECT MAX(created_at) INTO last_outbound
  FROM messages
  WHERE workshop_id = p_workshop_id AND direction = 'outbound';
  
  -- Estado de Gmail
  SELECT 
    CASE 
      WHEN gmail_connected = true AND gmail_refresh_token IS NOT NULL THEN 'connected'
      WHEN gmail_connected = true AND gmail_refresh_token IS NULL THEN 'error'
      ELSE 'disconnected'
    END INTO gmail_status
  FROM workshops WHERE id = p_workshop_id;
  
  -- Estado de WhatsApp
  SELECT whatsapp_connected INTO whatsapp_status
  FROM workshops WHERE id = p_workshop_id;
  
  -- Conversaciones con bot pausado
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