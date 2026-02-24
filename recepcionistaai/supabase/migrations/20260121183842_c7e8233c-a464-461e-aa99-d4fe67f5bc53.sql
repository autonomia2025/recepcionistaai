-- Add web chat columns to workshops
ALTER TABLE public.workshops 
ADD COLUMN IF NOT EXISTS web_chat_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS web_chat_allowed_domains TEXT[] DEFAULT '{}';

-- Add web session tracking to contacts
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS web_session_id TEXT;

-- Create index for web session lookups
CREATE INDEX IF NOT EXISTS idx_contacts_web_session_id ON public.contacts(web_session_id) WHERE web_session_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.workshops.web_chat_enabled IS 'Whether the embeddable web chat widget is enabled for this workshop';
COMMENT ON COLUMN public.workshops.web_chat_allowed_domains IS 'List of domains allowed to embed the chat widget (e.g., example.com, *.example.com)';
COMMENT ON COLUMN public.contacts.web_session_id IS 'Unique session ID for web chat visitors';