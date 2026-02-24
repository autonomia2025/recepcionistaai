-- Add metadata column to messages table for AI reasoning and other technical data
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Comment for clarity
COMMENT ON COLUMN public.messages.metadata IS 'Stores AI reasoning, confidence, intent and other technical metadata for outbound messages.';
