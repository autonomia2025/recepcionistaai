-- Add Instagram integration columns to workshops table
ALTER TABLE public.workshops
ADD COLUMN IF NOT EXISTS instagram_connected boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS instagram_page_id text,
ADD COLUMN IF NOT EXISTS instagram_access_token text,
ADD COLUMN IF NOT EXISTS instagram_connected_at timestamp with time zone;

-- Add 'instagram' as a valid channel for messages (if using enum, otherwise just document it)
COMMENT ON COLUMN public.messages.channel IS 'Message channel: whatsapp, instagram';