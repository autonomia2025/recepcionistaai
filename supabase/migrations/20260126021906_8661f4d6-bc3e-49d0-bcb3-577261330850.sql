-- Add new columns for email reminder customization
ALTER TABLE public.automations_settings 
ADD COLUMN IF NOT EXISTS reminder_24h_subject TEXT DEFAULT 'Recordatorio: Tu cita mañana en {{taller}}',
ADD COLUMN IF NOT EXISTS reminder_24h_body TEXT DEFAULT 'Hola {{nombre}},

Te recordamos que tienes una cita agendada para mañana:

📆 Fecha: {{fecha}}
🕐 Hora: {{hora}}
🔧 Servicio: {{servicio}}
📍 Dirección: {{direccion}}

Si necesitas cancelar o reprogramar, por favor contáctanos con anticipación.

¡Te esperamos!

{{taller}}
{{telefono}}',
ADD COLUMN IF NOT EXISTS reminder_3h_subject TEXT DEFAULT 'Tu cita es en 3 horas - {{taller}}',
ADD COLUMN IF NOT EXISTS reminder_3h_body TEXT DEFAULT 'Hola {{nombre}},

Tu cita es en 3 horas. ¡Te esperamos!

🕐 Hora: {{hora}}
🔧 Servicio: {{servicio}}
📍 Dirección: {{direccion}}

{{taller}}
{{telefono}}';

-- Drop old columns that are no longer needed (WhatsApp templates)
ALTER TABLE public.automations_settings 
DROP COLUMN IF EXISTS reminder_24h_text,
DROP COLUMN IF EXISTS reminder_2h_text,
DROP COLUMN IF EXISTS reminder_24h_template,
DROP COLUMN IF EXISTS reminder_2h_template;