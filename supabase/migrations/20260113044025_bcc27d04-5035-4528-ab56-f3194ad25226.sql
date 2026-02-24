-- Add bot_enabled and booking_url to workshops table
ALTER TABLE public.workshops 
ADD COLUMN IF NOT EXISTS bot_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS booking_url text;

-- Add system_prompt to bot_settings table
ALTER TABLE public.bot_settings 
ADD COLUMN IF NOT EXISTS system_prompt text;

-- Create index for faster lookups by phone_number_id
CREATE INDEX IF NOT EXISTS idx_workshops_phone_number_id ON public.workshops(whatsapp_phone_number_id);

-- Update booking_url for existing workshops based on slug
UPDATE public.workshops 
SET booking_url = '/agenda/' || slug 
WHERE slug IS NOT NULL AND booking_url IS NULL;