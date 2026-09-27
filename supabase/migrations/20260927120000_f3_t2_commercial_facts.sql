-- F3 · Tarea 2 — Hechos para el panel que habla y para "Mi día" (solo agrega).
--
-- commercial_facts(_scope) devuelve hechos, no frases: la pantalla arma las
-- frases con reglas (src/lib/insights.ts). Se calcula al abrir la pantalla.
--   _scope = 'team' → todo el taller (solo ADMIN o SUPERADMIN).
--   _scope = 'me'   → solo las solicitudes asignadas a quien consulta.
-- Monto de cada solicitud: neto de su última cotización vigente; si no tiene,
-- estimado con el máximo del catálogo de los equipos que el cliente eligió,
-- preguntó o cuya ficha recibió (marcado como estimado).
-- Solo workshops con el módulo comercial. Idempotente.

CREATE OR REPLACE FUNCTION public.commercial_facts(_scope text DEFAULT 'team')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _workshop uuid;
  _role text;
  _hours integer;
  _result jsonb;
BEGIN
  SELECT p.workshop_id, p.role::text INTO _workshop, _role FROM public.profiles p WHERE p.id = _uid;
  IF _workshop IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workshops w WHERE w.id = _workshop AND (w.features ->> 'commercial')::boolean IS TRUE) THEN
    RAISE EXCEPTION 'Módulo comercial no activo' USING ERRCODE = '42501';
  END IF;
  IF _scope NOT IN ('team', 'me') THEN
    RAISE EXCEPTION 'Alcance inválido' USING ERRCODE = '22023';
  END IF;
  IF _scope = 'team' AND _role NOT IN ('ADMIN', 'SUPERADMIN') THEN
    RAISE EXCEPTION 'Solo un administrador ve el resumen del equipo' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(cs.unquoted_lead_alert_hours, 48) INTO _hours FROM public.commercial_settings cs WHERE cs.workshop_id = _workshop;

  WITH scoped_requests AS (
    SELECT sr.*
    FROM public.service_requests sr
    WHERE sr.workshop_id = _workshop
      AND (_scope = 'team' OR sr.assigned_staff_id = _uid)
  ),
  open_requests AS (
    SELECT
      sr.id, sr.contact_id, sr.status::text AS status, sr.created_at, sr.assigned_at, sr.assigned_staff_id,
      c.name AS client, c.company_name AS company, c.zone,
      z.label AS zone_label,
      p.full_name AS staff_name,
      q.status AS quote_status, q.quote_number, q.sent_at, q.net_total AS quote_net,
      est.amount AS catalog_amount
    FROM scoped_requests sr
    JOIN public.contacts c ON c.id = sr.contact_id
    LEFT JOIN public.workshop_zones z ON z.workshop_id = sr.workshop_id AND z.key = c.zone
    LEFT JOIN public.profiles p ON p.id = sr.assigned_staff_id
    LEFT JOIN LATERAL (
      SELECT q.status, q.quote_number, q.sent_at, q.net_total
      FROM public.quotes q
      WHERE q.service_request_id = sr.id AND q.status NOT IN ('void', 'rejected')
      ORDER BY q.created_at DESC LIMIT 1
    ) q ON true
    LEFT JOIN LATERAL (
      SELECT sum(pc.price_max) AS amount
      FROM (SELECT DISTINCT e.sku_normalized FROM public.conversation_product_events e
            WHERE e.contact_id = sr.contact_id AND e.event_type IN ('chosen', 'customer_asked', 'datasheet_sent') AND e.sku_normalized IS NOT NULL) s
      JOIN public.product_catalog pc ON pc.workshop_id = sr.workshop_id AND pc.sku_normalized = s.sku_normalized
    ) est ON true
    WHERE sr.status NOT IN ('done', 'lost')
  ),
  closed_quotes AS (
    SELECT q.status AS outcome, q.closed_at, q.lost_reason, q.net_total,
           p.full_name AS staff_name, z.label AS zone_label, c.zone
    FROM public.quotes q
    JOIN scoped_requests sr ON sr.id = q.service_request_id
    JOIN public.contacts c ON c.id = q.contact_id
    LEFT JOIN public.workshop_zones z ON z.workshop_id = q.workshop_id AND z.key = c.zone
    LEFT JOIN public.profiles p ON p.id = coalesce(sr.assigned_staff_id, q.issued_by)
    WHERE q.status IN ('accepted', 'rejected') AND q.closed_at >= now() - interval '90 days'
  ),
  discounted AS (
    SELECT q.quote_number, q.max_discount_pct, q.service_request_id, q.issued_at, p.full_name AS staff_name
    FROM public.quotes q
    JOIN scoped_requests sr ON sr.id = q.service_request_id
    LEFT JOIN public.profiles p ON p.id = q.issued_by
    WHERE q.discount_over_threshold AND q.status <> 'draft' AND q.status <> 'void'
      AND q.issued_at >= date_trunc('month', now())
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'scope', _scope,
    'thresholds', jsonb_build_object(
      'unquoted_hours', _hours,
      'unassigned_hours', 4,
      'followup_days', 5,
      'discount_pct', (SELECT cs.discount_approval_threshold FROM public.commercial_settings cs WHERE cs.workshop_id = _workshop),
      'min_sample', 5
    ),
    'open_requests', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'client', o.client, 'company', o.company, 'zone', o.zone, 'zone_label', o.zone_label,
        'staff_id', o.assigned_staff_id, 'staff_name', o.staff_name, 'status', o.status,
        'created_at', o.created_at, 'assigned_at', o.assigned_at,
        'quote_status', o.quote_status, 'quote_number', o.quote_number, 'sent_at', o.sent_at,
        'amount', coalesce(o.quote_net, o.catalog_amount),
        'amount_is_estimate', o.quote_net IS NULL AND o.catalog_amount IS NOT NULL
      ) ORDER BY o.created_at) FROM open_requests o), '[]'::jsonb),
    'closed_quotes', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'outcome', cq.outcome, 'closed_at', cq.closed_at, 'lost_reason', cq.lost_reason, 'net_total', cq.net_total,
        'staff_name', cq.staff_name, 'zone_label', cq.zone_label
      )) FROM closed_quotes cq), '[]'::jsonb),
    'discounted', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'quote_number', d.quote_number, 'max_discount_pct', d.max_discount_pct,
        'request_id', d.service_request_id, 'staff_name', d.staff_name
      )) FROM discounted d), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.commercial_facts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_facts(text) TO authenticated;
