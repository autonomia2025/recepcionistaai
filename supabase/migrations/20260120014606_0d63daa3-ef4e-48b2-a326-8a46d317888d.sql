-- Create table to track message batching state per conversation
CREATE TABLE public.message_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  batch_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_message_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  message_count INTEGER NOT NULL DEFAULT 1,
  is_processing BOOLEAN NOT NULL DEFAULT false,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_active_batch UNIQUE (conversation_id, is_completed)
);

-- Create index for fast lookups
CREATE INDEX idx_message_batches_conversation ON public.message_batches(conversation_id, is_completed);
CREATE INDEX idx_message_batches_workshop ON public.message_batches(workshop_id);

-- Enable RLS
ALTER TABLE public.message_batches ENABLE ROW LEVEL SECURITY;

-- RLS policies - service role only (edge functions)
CREATE POLICY "Service role can manage batches" 
ON public.message_batches 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Add comment
COMMENT ON TABLE public.message_batches IS 'Tracks message batching for debounced AI replies';