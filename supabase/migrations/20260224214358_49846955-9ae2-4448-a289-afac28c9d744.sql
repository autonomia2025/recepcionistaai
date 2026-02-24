
-- ===== PROBLEMA 1: Add last_message_text to conversations =====
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS last_message_text text;

-- Create trigger to auto-update last_message_text on new message
CREATE OR REPLACE FUNCTION public.update_conversation_last_message_text()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_text = NEW.text,
      last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_conversation_last_message_text
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.update_conversation_last_message_text();

-- Backfill existing conversations with latest message text
UPDATE public.conversations c
SET last_message_text = sub.text
FROM (
  SELECT DISTINCT ON (conversation_id) conversation_id, text
  FROM public.messages
  ORDER BY conversation_id, created_at DESC
) sub
WHERE c.id = sub.conversation_id;

-- ===== PROBLEMA 2: Soft-delete for contacts =====
ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

-- Add index for filtering archived contacts
CREATE INDEX IF NOT EXISTS idx_contacts_archived ON public.contacts (workshop_id, archived);
