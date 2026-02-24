
-- Add last_message_text to conversations table to show context in inbox without joins
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_message_text TEXT;

-- Function to update last_message_text in conversations
CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET 
    last_message_text = NEW.text,
    last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on messages table
DROP TRIGGER IF EXISTS on_message_inserted ON public.messages;
CREATE TRIGGER on_message_inserted
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_conversation_last_message();

-- Update existing conversations with their last message text
UPDATE public.conversations c
SET last_message_text = (
  SELECT m.text 
  FROM public.messages m 
  WHERE m.conversation_id = c.id 
  ORDER BY m.created_at DESC 
  LIMIT 1
);
