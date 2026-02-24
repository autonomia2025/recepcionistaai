-- RPC to fetch all messages for a conversation, bypassing RLS
-- Ensures SUPERADMIN (impersonating) and workshop members always see inbound + outbound
CREATE OR REPLACE FUNCTION public.get_conversation_messages(_conversation_id uuid)
RETURNS TABLE(
  id uuid,
  conversation_id uuid,
  workshop_id uuid,
  text text,
  direction text,
  channel text,
  created_at timestamptz,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _conv_workshop_id uuid;
BEGIN
  -- Get the workshop_id of the conversation
  SELECT c.workshop_id INTO _conv_workshop_id
  FROM public.conversations c
  WHERE c.id = _conversation_id;

  IF _conv_workshop_id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  -- Authorization: must be SUPERADMIN or belong to the same workshop
  IF NOT (
    is_superadmin(auth.uid())
    OR get_user_workshop_id(auth.uid()) = _conv_workshop_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT 
    m.id, 
    m.conversation_id, 
    m.workshop_id, 
    m.text, 
    m.direction::text, 
    m.channel, 
    m.created_at,
    m.metadata
  FROM public.messages m
  WHERE m.conversation_id = _conversation_id
  ORDER BY m.created_at ASC;
END;
$$;