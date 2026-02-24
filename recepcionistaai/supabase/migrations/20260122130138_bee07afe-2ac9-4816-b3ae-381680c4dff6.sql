-- Add reminder tracking fields to appointments
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reminder_2h_sent_at TIMESTAMPTZ;

-- Extend automations_settings with template fields
ALTER TABLE automations_settings
ADD COLUMN IF NOT EXISTS reminder_24h_text TEXT DEFAULT 'Hola {{nombre}}, te recordamos que tienes una cita mañana {{fecha}} a las {{hora}} en {{direccion}}. ¡Te esperamos!',
ADD COLUMN IF NOT EXISTS reminder_2h_text TEXT DEFAULT 'Hola {{nombre}}, tu cita es en 2 horas ({{hora}}). Dirección: {{direccion}}. ¡Te esperamos!',
ADD COLUMN IF NOT EXISTS reminder_24h_template TEXT DEFAULT 'appointment_reminder_24h',
ADD COLUMN IF NOT EXISTS reminder_2h_template TEXT DEFAULT 'appointment_reminder_2h';

-- Create reminder_logs table for auditing
CREATE TABLE IF NOT EXISTS reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
  workshop_id UUID NOT NULL,
  contact_id UUID,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('reminder_24h', 'reminder_2h')),
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'template')),
  template_name TEXT,
  message_sent TEXT,
  provider_message_id TEXT,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'failed', 'read')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_reminder_logs_workshop_id ON reminder_logs(workshop_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_appointment_id ON reminder_logs(appointment_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_created_at ON reminder_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_24h ON appointments(start_datetime) WHERE reminder_24h_sent_at IS NULL AND status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_2h ON appointments(start_datetime) WHERE reminder_2h_sent_at IS NULL AND status = 'scheduled';

-- Enable RLS on reminder_logs
ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for reminder_logs
CREATE POLICY "ADMIN can view their workshop reminder_logs"
ON reminder_logs FOR SELECT
USING (workshop_id = get_user_workshop_id(auth.uid()));

CREATE POLICY "SUPERADMIN can manage all reminder_logs"
ON reminder_logs FOR ALL
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

CREATE POLICY "Service role can insert reminder_logs"
ON reminder_logs FOR INSERT
WITH CHECK (true);