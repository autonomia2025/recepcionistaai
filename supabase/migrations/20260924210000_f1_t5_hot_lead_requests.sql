-- F1 · Tarea 5 — Solicitud automática para leads calientes (solo agrega).
--
-- create_hot_lead_request() es el único creador automático de solicitudes. Lo
-- llama analyze-conversation (service role) en workshops con el módulo
-- comercial cuando el cliente tiene puntaje 80 o más, eligió un equipo del menú
-- o dejó RUT/empresa. Reglas:
--   · No crea si el cliente ya tiene una solicitud abierta (manual o automática).
--   · No crea si al cliente se le cerró una solicitud en los últimos 30 días.
--   · Se asigna al vendedor de la conversación; si no hay, queda sin asignar.
--   · Guarda el motivo en qualification.
-- Las solicitudes manuales no cambian. Idempotente.

ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS auto_created boolean NOT NULL DEFAULT false;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS qualification jsonb;

-- At most one open automatic request per contact, even under concurrent analyses.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_requests_open_auto
  ON public.service_requests (contact_id)
  WHERE auto_created AND status NOT IN ('done', 'lost');

CREATE OR REPLACE FUNCTION public.create_hot_lead_request(
  _contact_id uuid,
  _conversation_id uuid,
  _reasons jsonb,
  _description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _workshop uuid;
  _existing uuid;
  _assignee uuid;
  _channel text;
  _new_id uuid;
BEGIN
  SELECT c.workshop_id INTO _workshop FROM public.contacts c WHERE c.id = _contact_id;
  IF _workshop IS NULL THEN
    RETURN jsonb_build_object('created', false, 'reason', 'contact_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workshops w
    WHERE w.id = _workshop AND (w.features ->> 'commercial')::boolean IS TRUE
  ) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'commercial_disabled');
  END IF;

  IF _reasons IS NULL OR jsonb_typeof(_reasons) <> 'array' OR jsonb_array_length(_reasons) = 0 THEN
    RETURN jsonb_build_object('created', false, 'reason', 'no_reasons');
  END IF;

  -- Serialize concurrent analyses of the same contact.
  PERFORM pg_advisory_xact_lock(hashtext('hot_lead:' || _contact_id::text));

  SELECT sr.id INTO _existing
  FROM public.service_requests sr
  WHERE sr.contact_id = _contact_id AND sr.status NOT IN ('done', 'lost')
  ORDER BY sr.created_at DESC
  LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('created', false, 'reason', 'open_request_exists', 'request_id', _existing);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.service_requests sr
    WHERE sr.contact_id = _contact_id
      AND sr.status IN ('done', 'lost')
      AND coalesce(sr.closed_at, sr.updated_at) > now() - interval '30 days'
  ) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'closed_recently');
  END IF;

  SELECT p.id INTO _assignee
  FROM public.conversations cv
  JOIN public.profiles p ON p.id = cv.assigned_to_user_id
  WHERE cv.id = _conversation_id
    AND cv.contact_id = _contact_id
    AND p.workshop_id = _workshop
    AND p.status = 'active';

  SELECT m.channel INTO _channel
  FROM public.messages m
  WHERE m.conversation_id = _conversation_id AND m.direction = 'inbound'
  ORDER BY m.created_at DESC
  LIMIT 1;

  INSERT INTO public.service_requests (
    workshop_id, contact_id, conversation_id, service_category, description,
    urgency, status, source, assigned_staff_id, assigned_at, auto_created, qualification
  ) VALUES (
    _workshop, _contact_id, _conversation_id, 'Cotización de equipos', left(_description, 2000),
    'high', 'new', CASE WHEN _channel = 'web' THEN 'web' ELSE 'whatsapp' END::public.request_source,
    _assignee, CASE WHEN _assignee IS NOT NULL THEN now() END, true,
    jsonb_build_object('created_by', 'bot', 'reasons', _reasons, 'at', now())
  )
  RETURNING id INTO _new_id;

  RETURN jsonb_build_object('created', true, 'request_id', _new_id, 'assigned_staff_id', _assignee);
END;
$$;

REVOKE ALL ON FUNCTION public.create_hot_lead_request(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_hot_lead_request(uuid, uuid, jsonb, text) TO service_role;
