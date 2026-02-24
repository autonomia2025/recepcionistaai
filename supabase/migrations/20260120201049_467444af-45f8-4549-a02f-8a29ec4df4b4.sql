-- Add instagram_id column to contacts table for storing IGSID
ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS instagram_id text;

-- Add index for faster lookups by instagram_id
CREATE INDEX IF NOT EXISTS idx_contacts_instagram_id ON public.contacts(instagram_id) WHERE instagram_id IS NOT NULL;