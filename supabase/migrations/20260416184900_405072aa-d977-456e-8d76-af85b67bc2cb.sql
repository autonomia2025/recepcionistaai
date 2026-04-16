DROP VIEW IF EXISTS public.workshops_safe;

CREATE VIEW public.workshops_safe
WITH (security_invoker = true)
AS
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