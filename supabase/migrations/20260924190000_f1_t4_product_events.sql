-- F1 · Tarea 4 — Registro exacto de equipos por conversación (solo agrega).
--
-- build-ai-reply (service role) es el único que escribe: al final de cada turno,
-- en workshops con el módulo comercial, registra qué modelos del catálogo
-- escribió el cliente, mostró el bot, eligió el cliente y qué fichas se enviaron.
-- Lo leen los miembros del workshop; un vendedor con zona solo ve su zona
-- (misma regla que 20260924150100_f1_t1b_zone_scoped_access.sql).
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.conversation_product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CONSTRAINT conversation_product_events_type CHECK (event_type IN ('customer_asked', 'recommended', 'chosen', 'datasheet_sent')),
  sku_normalized text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_events_contact ON public.conversation_product_events (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_workshop ON public.conversation_product_events (workshop_id, created_at DESC);

ALTER TABLE public.conversation_product_events ENABLE ROW LEVEL SECURITY;

-- Single writer: only the service role (which bypasses RLS) inserts.
REVOKE ALL ON public.conversation_product_events FROM anon, authenticated;
GRANT SELECT ON public.conversation_product_events TO authenticated;
GRANT ALL ON public.conversation_product_events TO service_role;

DROP POLICY IF EXISTS "members_read_product_events" ON public.conversation_product_events;
CREATE POLICY "members_read_product_events" ON public.conversation_product_events
  FOR SELECT TO authenticated
  USING (workshop_id = public.get_user_workshop_id(auth.uid()) OR public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "zone_scope_select" ON public.conversation_product_events;
CREATE POLICY "zone_scope_select" ON public.conversation_product_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.current_staff_zone()) IS NULL
    OR EXISTS (
      SELECT 1 FROM public.contacts ct
      WHERE ct.id = conversation_product_events.contact_id
        AND ct.zone = (SELECT public.current_staff_zone())
    )
  );
