-- Add WhatsApp fields to workshops (managed by SUPERADMIN only)
ALTER TABLE public.workshops 
ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_business_account_id TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_access_token TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_verify_token TEXT DEFAULT encode(gen_random_bytes(16), 'hex'),
ADD COLUMN IF NOT EXISTS whatsapp_connected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS whatsapp_connected_at TIMESTAMPTZ;

-- Add AI analysis fields to contacts
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS whatsapp_id TEXT,
ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS detected_intent TEXT,
ADD COLUMN IF NOT EXISTS intent_confidence DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS should_recontact BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS recontact_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS recontact_reason TEXT,
ADD COLUMN IF NOT EXISTS last_analyzed_at TIMESTAMPTZ;

-- Add constraint for lead_score
ALTER TABLE public.contacts ADD CONSTRAINT contacts_lead_score_check CHECK (lead_score >= 0 AND lead_score <= 100);

-- Add AI analysis fields to conversations
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS ai_summary TEXT,
ADD COLUMN IF NOT EXISTS sentiment TEXT;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp ON public.contacts(whatsapp_id);
CREATE INDEX IF NOT EXISTS idx_contacts_lead_score ON public.contacts(workshop_id, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_recontact ON public.contacts(workshop_id, should_recontact, recontact_at);

-- Enable realtime for conversations only (messages may already be enabled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END $$;