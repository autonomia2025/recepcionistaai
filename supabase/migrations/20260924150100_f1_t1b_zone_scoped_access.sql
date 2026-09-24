-- F1 · Tarea 1 (2/2) — La zona del vendedor se aplica en la base, no solo en la pantalla.
-- Correr DESPUÉS de 20260924150000_f1_t1a_set_contact_zone.sql y de publicar el
-- frontend que cambia la zona con set_contact_zone().
--
-- Regla (la misma que ya aplican Inbox, Clientes y Dashboard en el navegador):
-- un STAFF con zona asignada, en un workshop con features.zones = true, solo
-- puede leer y modificar contactos de su zona y lo que cuelga de ellos
-- (conversaciones, mensajes, ítems de cotización, lotes de mensajes).
-- ADMIN, SUPERADMIN, STAFF sin zona y workshops sin zonas: sin cambios.
--
-- Son políticas RESTRICTIVE: se suman (AND) a las existentes sin reescribirlas.
-- INSERT no se restringe (crear no expone datos de otra zona).
-- Idempotente.

DO $$
BEGIN
  IF to_regprocedure('public.current_staff_zone()') IS NULL THEN
    RAISE EXCEPTION 'Falta current_staff_zone(): correr antes 20260924150000_f1_t1a_set_contact_zone.sql';
  END IF;
END $$;

-- 1. Políticas. (SELECT public.current_staff_zone()) se evalúa una sola vez por
--    consulta; para quien no tiene restricción la condición es verdadera de inmediato.
DO $$
DECLARE
  _t record;
  _in_zone text;
BEGIN
  FOR _t IN
    SELECT * FROM (VALUES
      ('contacts',
       'zone = (SELECT public.current_staff_zone())'),
      ('conversations',
       'EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.id = conversations.contact_id AND ct.zone = (SELECT public.current_staff_zone()))'),
      ('messages',
       'EXISTS (SELECT 1 FROM public.conversations c JOIN public.contacts ct ON ct.id = c.contact_id WHERE c.id = messages.conversation_id AND ct.zone = (SELECT public.current_staff_zone()))'),
      ('quotation_items',
       'EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.id = quotation_items.contact_id AND ct.zone = (SELECT public.current_staff_zone()))'),
      ('message_batches',
       'EXISTS (SELECT 1 FROM public.conversations c JOIN public.contacts ct ON ct.id = c.contact_id WHERE c.id = message_batches.conversation_id AND ct.zone = (SELECT public.current_staff_zone()))')
    ) AS v(tbl, cond)
  LOOP
    _in_zone := format('((SELECT public.current_staff_zone()) IS NULL OR %s)', _t.cond);

    EXECUTE format('DROP POLICY IF EXISTS "zone_scope_select" ON public.%I', _t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS "zone_scope_update" ON public.%I', _t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS "zone_scope_delete" ON public.%I', _t.tbl);

    EXECUTE format('CREATE POLICY "zone_scope_select" ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING %s', _t.tbl, _in_zone);
    EXECUTE format('CREATE POLICY "zone_scope_update" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING %s WITH CHECK (true)', _t.tbl, _in_zone);
    EXECUTE format('CREATE POLICY "zone_scope_delete" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING %s', _t.tbl, _in_zone);
  END LOOP;
END $$;

-- 2. El Inbox carga los mensajes con esta función, que salta las políticas
--    (SECURITY DEFINER). Mismo contrato que antes, más la regla de zona.
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
  _conv_zone text;
  _staff_zone text;
BEGIN
  SELECT c.workshop_id, ct.zone INTO _conv_workshop_id, _conv_zone
  FROM public.conversations c
  LEFT JOIN public.contacts ct ON ct.id = c.contact_id
  WHERE c.id = _conversation_id;

  IF _conv_workshop_id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF NOT (
    is_superadmin(auth.uid())
    OR get_user_workshop_id(auth.uid()) = _conv_workshop_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  _staff_zone := public.current_staff_zone();
  IF _staff_zone IS NOT NULL AND _conv_zone IS DISTINCT FROM _staff_zone THEN
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
