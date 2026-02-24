-- Add Twilio-related columns to workshops table
ALTER TABLE public.workshops 
ADD COLUMN IF NOT EXISTS whatsapp_provider TEXT NOT NULL DEFAULT 'meta',
ADD COLUMN IF NOT EXISTS twilio_phone_number TEXT,
ADD COLUMN IF NOT EXISTS twilio_phone_sid TEXT;

-- Add constraint to ensure valid provider values
ALTER TABLE public.workshops 
ADD CONSTRAINT workshops_whatsapp_provider_check 
CHECK (whatsapp_provider IN ('meta', 'twilio'));

-- Add comment for documentation
COMMENT ON COLUMN public.workshops.whatsapp_provider IS 'WhatsApp provider: meta (Cloud API) or twilio';
COMMENT ON COLUMN public.workshops.twilio_phone_number IS 'Twilio WhatsApp number in E.164 format (e.g., +14155238886)';
COMMENT ON COLUMN public.workshops.twilio_phone_sid IS 'Twilio Phone Number SID for reference';