-- F2 · Tarea 5 — Envío y cierre de la cotización oficial (solo agrega).
--
--   mark_quote_sent  oficial → enviada. Completa en la solicitud los mismos
--                    campos que el flujo manual "Marcar cotización enviada"
--                    (quoted_at, quoted_by, quote_amount = neto, quote_file_url =
--                    PDF) y la pasa a "Cotizada" si estaba antes en el embudo.
--                    Así el bloque de la solicitud y Control de ventas no cambian.
--   close_quote      oficial/enviada → aceptada (solicitud "Completada", que
--                    Control de ventas cuenta como vendida) o rechazada con motivo
--                    (y, si se pide, solicitud "Perdida" con ese motivo).
--   void_quote       oficial/enviada → anulada, con motivo.
--   revise_quote     copia una cotización oficial como borrador nuevo
--                    (revision_of) para renegociar.
-- Idempotente.

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS sent_via text;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS lost_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_sent_via_valid') THEN
    ALTER TABLE public.quotes ADD CONSTRAINT quotes_sent_via_valid
      CHECK (sent_via IS NULL OR sent_via IN ('email', 'whatsapp', 'in_person', 'other'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mark_quote_sent(_quote_id uuid, _sent_via text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _q public.quotes%ROWTYPE;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_work_quote(_q.workshop_id, _q.contact_id) THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501'; END IF;
  IF _q.status <> 'issued' THEN
    RAISE EXCEPTION 'Solo una cotización oficial sin enviar se puede marcar como enviada' USING ERRCODE = '55000';
  END IF;
  IF _q.pdf_path IS NULL THEN
    RAISE EXCEPTION 'Primero crea el PDF de la cotización' USING ERRCODE = '55000';
  END IF;

  UPDATE public.quotes
    SET status = 'sent', sent_at = now(), sent_by = auth.uid(), sent_via = _sent_via
  WHERE id = _quote_id;

  IF _q.service_request_id IS NOT NULL THEN
    UPDATE public.service_requests SET
      quoted_at = now(),
      quoted_by = auth.uid(),
      quote_amount = _q.net_total,
      quote_file_url = _q.pdf_path,
      status = CASE WHEN status IN ('new', 'contacting', 'waiting_customer', 'scheduled_visit') THEN 'quoted' ELSE status END,
      updated_at = now()
    WHERE id = _q.service_request_id;
  END IF;

  RETURN jsonb_build_object('quote_id', _quote_id, 'status', 'sent');
END;
$$;

CREATE OR REPLACE FUNCTION public.close_quote(_quote_id uuid, _outcome text, _lost_reason text DEFAULT NULL, _close_request boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _q public.quotes%ROWTYPE;
  _reason text := nullif(btrim(coalesce(_lost_reason, '')), '');
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_work_quote(_q.workshop_id, _q.contact_id) THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501'; END IF;
  IF _q.status NOT IN ('issued', 'sent') THEN
    RAISE EXCEPTION 'Esta cotización ya está cerrada o todavía no es oficial' USING ERRCODE = '55000';
  END IF;
  IF _outcome NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Resultado inválido: %', _outcome USING ERRCODE = '22023';
  END IF;
  IF _outcome = 'rejected' AND _reason IS NULL THEN
    RAISE EXCEPTION 'Indica el motivo del rechazo' USING ERRCODE = '22023';
  END IF;

  UPDATE public.quotes
    SET status = _outcome, closed_at = now(), lost_reason = CASE WHEN _outcome = 'rejected' THEN _reason END
  WHERE id = _quote_id;

  IF _q.service_request_id IS NOT NULL AND _close_request THEN
    UPDATE public.service_requests SET
      status = CASE WHEN _outcome = 'accepted' THEN 'done' ELSE 'lost' END::public.service_request_status,
      closed_at = now(),
      lost_reason = CASE WHEN _outcome = 'rejected' THEN _reason END,
      -- An accepted quote that was never marked as sent still counts as quoted.
      quoted_at = coalesce(quoted_at, CASE WHEN _outcome = 'accepted' THEN now() END),
      quoted_by = coalesce(quoted_by, CASE WHEN _outcome = 'accepted' THEN auth.uid() END),
      quote_amount = CASE WHEN _outcome = 'accepted' THEN _q.net_total ELSE quote_amount END,
      quote_file_url = coalesce(quote_file_url, CASE WHEN _outcome = 'accepted' THEN _q.pdf_path END),
      updated_at = now()
    WHERE id = _q.service_request_id;
  END IF;

  RETURN jsonb_build_object('quote_id', _quote_id, 'status', _outcome);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_quote(_quote_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _q public.quotes%ROWTYPE;
  _why text := nullif(btrim(coalesce(_reason, '')), '');
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_work_quote(_q.workshop_id, _q.contact_id) THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501'; END IF;
  IF _q.status NOT IN ('issued', 'sent') THEN
    RAISE EXCEPTION 'Solo se anula una cotización oficial o enviada' USING ERRCODE = '55000';
  END IF;
  IF _why IS NULL THEN RAISE EXCEPTION 'Indica por qué se anula' USING ERRCODE = '22023'; END IF;

  UPDATE public.quotes SET status = 'void', closed_at = now(), void_reason = _why WHERE id = _quote_id;
  RETURN jsonb_build_object('quote_id', _quote_id, 'status', 'void');
END;
$$;

CREATE OR REPLACE FUNCTION public.revise_quote(_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _q public.quotes%ROWTYPE;
  _existing uuid;
  _new uuid;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_work_quote(_q.workshop_id, _q.contact_id) THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501'; END IF;
  IF _q.status = 'draft' THEN RAISE EXCEPTION 'Esta cotización todavía está en preparación' USING ERRCODE = '55000'; END IF;

  -- One open draft per request: continue it instead of creating another.
  IF _q.service_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('quote_draft:' || _q.service_request_id::text));
    SELECT id INTO _existing FROM public.quotes
    WHERE service_request_id = _q.service_request_id AND status = 'draft' ORDER BY created_at DESC LIMIT 1;
    IF _existing IS NOT NULL THEN
      RETURN jsonb_build_object('quote_id', _existing, 'created', false);
    END IF;
  END IF;

  INSERT INTO public.quotes (
    workshop_id, service_request_id, contact_id, conversation_id, revision_of,
    client_name, client_company, client_tax_id, client_email, client_phone, client_address,
    vat_rate, validity_days, payment_terms, delivery_terms, legal_footer, notes, global_discount_pct, created_by
  ) VALUES (
    _q.workshop_id, _q.service_request_id, _q.contact_id, _q.conversation_id, _q.id,
    _q.client_name, _q.client_company, _q.client_tax_id, _q.client_email, _q.client_phone, _q.client_address,
    _q.vat_rate, _q.validity_days, _q.payment_terms, _q.delivery_terms, _q.legal_footer, _q.notes, _q.global_discount_pct, auth.uid()
  ) RETURNING id INTO _new;

  INSERT INTO public.quote_lines (quote_id, position, sku, sku_normalized, description, quantity, unit_price, discount_pct, price_min, price_max, source)
  SELECT _new, position, sku, sku_normalized, description, quantity, unit_price, discount_pct, price_min, price_max, source
  FROM public.quote_lines WHERE quote_id = _quote_id ORDER BY position, created_at;

  RETURN jsonb_build_object('quote_id', _new, 'created', true);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_quote_sent(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_quote(uuid, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_quote(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revise_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_quote_sent(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_quote(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_quote(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revise_quote(uuid) TO authenticated;
