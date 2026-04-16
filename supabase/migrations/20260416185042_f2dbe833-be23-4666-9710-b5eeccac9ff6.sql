-- Ensure RLS is enabled on messages (already has policies, just enforce)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Add an explicit workshop-member read policy (idempotent)
DROP POLICY IF EXISTS "workshop_members_read_messages" ON public.messages;
CREATE POLICY "workshop_members_read_messages"
ON public.messages FOR SELECT
USING (
  auth.uid() IN (
    SELECT id FROM public.profiles
    WHERE workshop_id = messages.workshop_id
  )
);

-- Lock down message_batches: enable RLS and add workshop-member read policy
ALTER TABLE public.message_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workshop_members_read_message_batches" ON public.message_batches;
CREATE POLICY "workshop_members_read_message_batches"
ON public.message_batches FOR SELECT
USING (
  auth.uid() IN (
    SELECT id FROM public.profiles
    WHERE workshop_id = message_batches.workshop_id
  )
);