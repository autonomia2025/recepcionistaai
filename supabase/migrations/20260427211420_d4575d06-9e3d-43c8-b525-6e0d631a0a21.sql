-- Drop existing constraint and recreate with kapso included
ALTER TABLE public.workshops 
DROP CONSTRAINT IF EXISTS workshops_whatsapp_provider_check;

ALTER TABLE public.workshops 
ADD CONSTRAINT workshops_whatsapp_provider_check 
CHECK (whatsapp_provider IN ('meta', 'twilio', 'ycloud', 'kapso'));

COMMENT ON COLUMN public.workshops.whatsapp_provider IS 'WhatsApp provider: meta (Cloud API), twilio, ycloud, or kapso (Meta Business Partner wrapper)';