-- Safe view excluding sensitive token columns
CREATE OR REPLACE VIEW public.workshops_safe AS
SELECT
  id, name, slug, phone, address, city, category,
  booking_url, booking_mode, bot_enabled,
  web_chat_enabled, web_chat_allowed_domains,
  whatsapp_connected, whatsapp_connected_at, whatsapp_provider,
  instagram_connected, instagram_connected_at,
  gmail_connected, gmail_connected_at, gmail_email,
  is_active, created_at,
  admin_notification_email,
  email_notifications_appointment, email_notifications_handoff,
  email_notifications_hot_lead, email_notifications_quotation,
  email_monthly_report, email_reminders_enabled,
  email_sender_name, email_primary_color, email_button_color,
  email_logo_url, email_use_branding,
  zone_notification_emails
FROM public.workshops;

-- Ensure RLS enabled
ALTER TABLE public.workshops ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists then recreate
DROP POLICY IF EXISTS "staff_read_own_workshop" ON public.workshops;

CREATE POLICY "staff_read_own_workshop" ON public.workshops
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM public.profiles
      WHERE workshop_id = workshops.id
    )
  );