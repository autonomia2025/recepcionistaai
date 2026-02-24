-- Add web chat customization columns to workshops table
ALTER TABLE public.workshops 
ADD COLUMN IF NOT EXISTS web_chat_primary_color text DEFAULT '#3B82F6',
ADD COLUMN IF NOT EXISTS web_chat_position text DEFAULT 'bottom-right',
ADD COLUMN IF NOT EXISTS web_chat_title text DEFAULT 'Asistente Virtual',
ADD COLUMN IF NOT EXISTS web_chat_welcome_message text DEFAULT '¿En qué podemos ayudarte hoy?',
ADD COLUMN IF NOT EXISTS web_chat_z_index text DEFAULT '999999';