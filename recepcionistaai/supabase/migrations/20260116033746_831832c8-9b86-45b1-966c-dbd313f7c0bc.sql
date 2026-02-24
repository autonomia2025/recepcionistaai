-- Add bot_paused field to conversations table
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS bot_paused boolean DEFAULT false;

-- Add comment
COMMENT ON COLUMN public.conversations.bot_paused IS 'When true, the bot will not auto-respond to this conversation';