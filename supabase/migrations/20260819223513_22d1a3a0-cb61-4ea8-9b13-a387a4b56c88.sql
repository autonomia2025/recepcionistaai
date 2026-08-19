DO $$
DECLARE w uuid;
BEGIN
  SELECT id INTO w FROM public.workshops WHERE name ILIKE '%SOC%Ingenier%' LIMIT 1;
  IF w IS NULL THEN RAISE NOTICE 'workshop not found'; RETURN; END IF;

  DELETE FROM public.message_batches WHERE workshop_id = w;
  DELETE FROM public.messages WHERE workshop_id = w;
  DELETE FROM public.conversations WHERE workshop_id = w;

  UPDATE public.contacts SET
    detected_intent = NULL,
    intent_confidence = NULL,
    lead_score = 0,
    lead_score_reasoning = NULL,
    should_recontact = false,
    recontact_at = NULL,
    recontact_reason = NULL,
    did_schedule = false,
    schedule_confidence = NULL,
    last_analyzed_at = NULL,
    quote_sent = false,
    quote_sent_at = NULL
  WHERE workshop_id = w;
END $$;