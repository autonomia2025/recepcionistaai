ALTER TABLE public.message_batches DROP CONSTRAINT IF EXISTS unique_active_batch;
DROP INDEX IF EXISTS public.unique_active_batch;

CREATE UNIQUE INDEX unique_active_batch
  ON public.message_batches (conversation_id)
  WHERE is_completed = false;

DELETE FROM public.message_batches
WHERE is_completed = false
  AND last_message_at < NOW() - INTERVAL '2 minutes';