-- F2 · Tarea 2 — Borrador automático de cotización (solo agrega).
--
-- create_quote_draft(solicitud) arma un borrador listo para revisar:
--   · Cliente: nombre, empresa, RUT, correo y teléfono del contacto; dirección
--     de la solicitud (o su comuna).
--   · Líneas: un equipo del catálogo por línea, desde conversation_product_events
--     del contacto, en este orden: eligió > pidió > recibió ficha. Lo que el bot
--     solo recomendó no entra (el editor lo muestra como sugerencia).
--     Precio unitario = máximo del rango del catálogo; el rango queda guardado.
--   · Condiciones: las de Configuración comercial (las pone quotes_before_write).
--   · Si la solicitud ya tiene un borrador abierto, lo devuelve en vez de crear
--     otro.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.catalog_line_description(_row public.product_catalog)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT concat_ws(' · ',
    'Hidrolavadora' || coalesce(' ' || nullif(lower(btrim(_row.water_type)), ''), ''),
    nullif(regexp_replace(lower(btrim(coalesce(_row.motor_type, ''))), '(\d+)\s*v\M', '\1V', 'g'), ''),
    CASE WHEN nullif(btrim(_row.pressure_bar), '') IS NOT NULL THEN btrim(_row.pressure_bar) || ' bar' END,
    CASE WHEN nullif(btrim(_row.flow_lmin), '') IS NOT NULL THEN btrim(_row.flow_lmin) || ' L/min' END,
    CASE WHEN nullif(btrim(_row.temp_max), '') IS NOT NULL AND btrim(_row.temp_max) <> '—'
      THEN 'temp. máx. ' || btrim(_row.temp_max) || '°C' END
  )
$$;

CREATE OR REPLACE FUNCTION public.create_quote_draft(_service_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _r public.service_requests%ROWTYPE;
  _c public.contacts%ROWTYPE;
  _existing uuid;
  _quote_id uuid;
  _lines integer;
BEGIN
  SELECT * INTO _r FROM public.service_requests WHERE id = _service_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_work_quote(_r.workshop_id, _r.contact_id) THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;

  -- One open draft per request.
  PERFORM pg_advisory_xact_lock(hashtext('quote_draft:' || _service_request_id::text));
  SELECT q.id INTO _existing FROM public.quotes q
  WHERE q.service_request_id = _service_request_id AND q.status = 'draft'
  ORDER BY q.created_at DESC LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('quote_id', _existing, 'created', false);
  END IF;

  SELECT * INTO _c FROM public.contacts WHERE id = _r.contact_id;

  INSERT INTO public.quotes (
    workshop_id, service_request_id, contact_id, conversation_id,
    client_name, client_company, client_tax_id, client_email, client_phone, client_address, created_by
  ) VALUES (
    _r.workshop_id, _r.id, _r.contact_id, _r.conversation_id,
    _c.name, _c.company_name, _c.tax_id, _c.email, _c.phone,
    coalesce(nullif(btrim(_r.address), ''), nullif(btrim(_r.comuna), '')), auth.uid()
  )
  RETURNING id INTO _quote_id;

  INSERT INTO public.quote_lines (quote_id, position, sku, sku_normalized, description, quantity, unit_price, price_min, price_max, source)
  SELECT _quote_id, row_number() OVER (ORDER BY e.rank, e.first_at),
         p.sku, p.sku_normalized, public.catalog_line_description(p), 1,
         coalesce(p.price_max, p.price_min, 0), p.price_min, p.price_max, e.source
  FROM (
    SELECT sku_normalized,
           min(CASE event_type WHEN 'chosen' THEN 1 WHEN 'customer_asked' THEN 2 ELSE 3 END) AS rank,
           (array_agg(event_type ORDER BY CASE event_type WHEN 'chosen' THEN 1 WHEN 'customer_asked' THEN 2 ELSE 3 END))[1] AS source,
           min(created_at) AS first_at
    FROM public.conversation_product_events
    WHERE contact_id = _r.contact_id
      AND event_type IN ('chosen', 'customer_asked', 'datasheet_sent')
      AND sku_normalized IS NOT NULL
    GROUP BY sku_normalized
  ) e
  JOIN public.product_catalog p ON p.workshop_id = _r.workshop_id AND p.sku_normalized = e.sku_normalized;

  GET DIAGNOSTICS _lines = ROW_COUNT;
  RETURN jsonb_build_object('quote_id', _quote_id, 'created', true, 'lines', _lines);
END;
$$;

REVOKE ALL ON FUNCTION public.create_quote_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quote_draft(uuid) TO authenticated;
