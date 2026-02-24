-- ============================================
-- PHASE 1: Add notification columns for quotations (chatbot_only workshops)
-- ============================================

-- Add quotation notification toggle to workshops
ALTER TABLE public.workshops
ADD COLUMN IF NOT EXISTS email_notifications_quotation BOOLEAN DEFAULT false;

-- ============================================
-- PHASE 2: Add appointment confirmation tracking
-- ============================================

-- Add confirmed_at column to appointments for tracking email confirmations
ALTER TABLE public.appointments
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS confirmed_via TEXT; -- 'email_link', 'phone', 'manual'

-- Add reschedule_token for secure reschedule links (different from cancel_token)
ALTER TABLE public.appointments
ADD COLUMN IF NOT EXISTS original_appointment_id UUID REFERENCES public.appointments(id);

-- ============================================
-- PHASE 3: Appointment action logs for tracking confirmations/cancellations from email
-- ============================================

CREATE TABLE IF NOT EXISTS public.appointment_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- 'confirmed', 'cancelled', 'rescheduled'
  action_source TEXT NOT NULL, -- 'email_reminder_24h', 'email_reminder_3h', 'manual', 'public_page'
  action_token TEXT, -- Token used for the action (for security audit)
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS for appointment_actions
ALTER TABLE public.appointment_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage appointment_actions"
ON public.appointment_actions FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Users can view their workshop appointment_actions"
ON public.appointment_actions FOR SELECT
USING (workshop_id = get_user_workshop_id(auth.uid()));

CREATE POLICY "SUPERADMIN can view all appointment_actions"
ON public.appointment_actions FOR SELECT
USING (is_superadmin(auth.uid()));

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_appointment_actions_appointment 
ON public.appointment_actions(appointment_id);

CREATE INDEX IF NOT EXISTS idx_appointment_actions_workshop 
ON public.appointment_actions(workshop_id, created_at DESC);

-- ============================================
-- PHASE 4: Internal notification logs 
-- ============================================

CREATE TABLE IF NOT EXISTS public.internal_notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL, -- 'human_handoff', 'hot_lead', 'quotation', 'appointment'
  contact_id UUID REFERENCES public.contacts(id),
  conversation_id UUID REFERENCES public.conversations(id),
  appointment_id UUID REFERENCES public.appointments(id),
  service_request_id UUID REFERENCES public.service_requests(id),
  email_to TEXT NOT NULL,
  email_subject TEXT NOT NULL,
  status TEXT DEFAULT 'sent', -- 'sent', 'failed'
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS for internal_notification_logs
ALTER TABLE public.internal_notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage internal_notification_logs"
ON public.internal_notification_logs FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "ADMIN can view their workshop internal_notification_logs"
ON public.internal_notification_logs FOR SELECT
USING (workshop_id = get_user_workshop_id(auth.uid()));

CREATE POLICY "SUPERADMIN can view all internal_notification_logs"
ON public.internal_notification_logs FOR SELECT
USING (is_superadmin(auth.uid()));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_internal_notification_logs_workshop 
ON public.internal_notification_logs(workshop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_notification_logs_type 
ON public.internal_notification_logs(notification_type, created_at DESC);