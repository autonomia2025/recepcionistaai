-- F4.5 · T3: priority you can explain, a promise of attention for urgent
-- leads, and "Interesados" (commercial module only).
--
-- - lead_priority(): why a lead matters, in words. Urgent = the client asked
--   for a quote, or wrote a deadline ("la necesito esta semana", "urgente").
-- - Urgent leads reach the seller at once (not in the next 10-minute run) and,
--   if nobody attends them within commercial_settings.urgent_attention_hours
--   business hours (default 2), the seller is reminded and admins are told.
--   "Attended" = the seller emailed the client, sent a quote or moved the
--   request out of "Nueva" (service_requests.first_contact_at, set here).
-- - "Interesados": clients with questions or asking prices who have not asked
--   for a quote. They never enter Solicitudes; a seller can take one.
-- Additive: one column with a default, triggers that only fill the unused
-- first_contact_at, new functions; run_commercial_alerts and
-- commercial_lead_inbox are replaced with the same behavior plus the new parts.

ALTER TABLE public.commercial_settings
  ADD COLUMN IF NOT EXISTS urgent_attention_hours numeric(4, 1) NOT NULL DEFAULT 2
  CONSTRAINT commercial_settings_urgent_hours_range CHECK (urgent_attention_hours > 0 AND urgent_attention_hours <= 72);

-- "2" instead of "2.0", "1.5" stays.
CREATE OR REPLACE FUNCTION public.hours_text(_value numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN _value = trunc(_value) THEN trunc(_value)::text ELSE replace(round(_value, 1)::text, '.', ',') END;
$$;

-- ---------------------------------------------------------------------------
-- Business hours between two instants, using the workshop's days and hours.
CREATE OR REPLACE FUNCTION public.business_hours_between(_workshop uuid, _from timestamptz, _to timestamptz)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _tz text; _days smallint[]; _opens time; _closes time;
  _d date; _last date; _start timestamptz; _end timestamptz;
  _total numeric := 0;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN RETURN 0; END IF;
  SELECT coalesce(cs.timezone, 'America/Santiago'), coalesce(cs.business_days, '{1,2,3,4,5}'),
         coalesce(cs.business_opens_at, '09:00'), coalesce(cs.business_closes_at, '18:00')
    INTO _tz, _days, _opens, _closes
  FROM public.commercial_settings cs WHERE cs.workshop_id = _workshop;
  _tz := coalesce(_tz, 'America/Santiago'); _days := coalesce(_days, '{1,2,3,4,5}'); _opens := coalesce(_opens, '09:00'); _closes := coalesce(_closes, '18:00');
  _d := (_from AT TIME ZONE _tz)::date;
  _last := least((_to AT TIME ZONE _tz)::date, _d + 62);
  WHILE _d <= _last LOOP
    IF extract(isodow FROM _d)::int = ANY (_days) THEN
      _start := greatest(_from, (_d + _opens) AT TIME ZONE _tz);
      _end := least(_to, (_d + _closes) AT TIME ZONE _tz);
      IF _end > _start THEN _total := _total + extract(epoch FROM _end - _start) / 3600; END IF;
    END IF;
    _d := _d + 1;
  END LOOP;
  RETURN round(_total, 2);
END;
$$;

-- ---------------------------------------------------------------------------
-- Why a lead matters. Reasons come from what the client actually wrote.
CREATE OR REPLACE FUNCTION public.lead_priority(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _sr record;
  _reasons jsonb := '[]'::jsonb;
  _quote text;
  _billing jsonb;
  _deadline text;
  _kind text;
BEGIN
  SELECT sr.id, sr.contact_id, sr.auto_created, sr.qualification, sr.created_at INTO _sr
  FROM public.service_requests sr WHERE sr.id = _request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT r ->> 'evidence' INTO _quote
  FROM jsonb_array_elements(coalesce(_sr.qualification -> 'reasons', '[]'::jsonb)) r
  WHERE r ->> 'rule' = 'quote_requested' LIMIT 1;
  SELECT r INTO _billing
  FROM jsonb_array_elements(coalesce(_sr.qualification -> 'reasons', '[]'::jsonb)) r
  WHERE r ->> 'rule' = 'billing_data' LIMIT 1;

  -- A deadline in the client's own words (last 30 days of their messages).
  SELECT left(m.text, 140) INTO _deadline
  FROM public.messages m
  JOIN public.conversations cv ON cv.id = m.conversation_id
  WHERE cv.contact_id = _sr.contact_id AND m.direction = 'inbound'
    AND m.created_at >= greatest(_sr.created_at, now()) - interval '30 days'
    AND m.text ~* '(urgente|urgencia|lo antes posible|cuanto antes|lo m[aá]s pronto|asap|para (hoy|ma[ñn]ana|esta semana|la pr[oó]xima semana|este mes|fin de mes)|esta semana|este mes|antes del? [0-9]+)'
  ORDER BY m.created_at DESC LIMIT 1;

  IF _quote IS NOT NULL THEN _reasons := _reasons || jsonb_build_object('code', 'quote_requested', 'text', _quote); END IF;
  IF _deadline IS NOT NULL THEN _reasons := _reasons || jsonb_build_object('code', 'deadline', 'text', _deadline); END IF;
  IF _billing IS NOT NULL THEN
    _reasons := _reasons || jsonb_build_object('code', 'billing_data',
      'text', concat_ws(' · ', nullif(_billing ->> 'company_name', ''), CASE WHEN _billing ->> 'tax_id' IS NOT NULL THEN 'RUT ' || (_billing ->> 'tax_id') END));
  END IF;

  _kind := CASE
    WHEN _quote IS NOT NULL THEN 'quote_requested'
    WHEN _billing IS NOT NULL THEN 'billing_data'
    WHEN _sr.qualification ->> 'created_by' = 'seller' THEN 'taken'
    WHEN _sr.auto_created THEN 'auto'
    ELSE 'manual' END;

  RETURN jsonb_build_object('urgent', _quote IS NOT NULL OR _deadline IS NOT NULL, 'kind', _kind, 'reasons', _reasons);
END;
$$;

REVOKE ALL ON FUNCTION public.business_hours_between(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_priority(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Attended": first time the seller acts on the lead.
CREATE OR REPLACE FUNCTION public.request_first_contact_on_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.first_contact_at IS NULL AND OLD.status = 'new' AND NEW.status <> 'new' THEN
    NEW.first_contact_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_requests_first_contact ON public.service_requests;
CREATE TRIGGER service_requests_first_contact
  BEFORE UPDATE OF status ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.request_first_contact_on_status();

CREATE OR REPLACE FUNCTION public.request_first_contact_on_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.direction = 'out' THEN
    UPDATE public.service_requests
      SET first_contact_at = NEW.sent_at
    WHERE contact_id = NEW.contact_id AND first_contact_at IS NULL
      AND status NOT IN ('done', 'lost') AND created_at <= NEW.sent_at;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS contact_emails_first_contact ON public.contact_emails;
CREATE TRIGGER contact_emails_first_contact
  AFTER INSERT ON public.contact_emails
  FOR EACH ROW EXECUTE FUNCTION public.request_first_contact_on_email();

-- Requests already worked before this existed count as attended.
UPDATE public.service_requests
  SET first_contact_at = coalesce(quoted_at, updated_at, created_at)
WHERE first_contact_at IS NULL AND status <> 'new';

-- ---------------------------------------------------------------------------
-- Urgent leads reach the seller at once (or the admins, if nobody got it).
-- Same alert keys as the 10-minute job, so nothing is sent twice.
CREATE OR REPLACE FUNCTION public.notify_urgent_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _p jsonb;
  _client text;
  _why text;
  _admin record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workshops w WHERE w.id = NEW.workshop_id AND (w.features ->> 'commercial')::boolean IS TRUE) THEN
    RETURN NULL;
  END IF;
  IF NEW.status <> 'new' OR NEW.first_contact_at IS NOT NULL THEN RETURN NULL; END IF;
  _p := public.lead_priority(NEW.id);
  IF NOT coalesce((_p ->> 'urgent')::boolean, false) THEN RETURN NULL; END IF;

  SELECT coalesce(nullif(c.company_name, ''), c.name) INTO _client FROM public.contacts c WHERE c.id = NEW.contact_id;
  _why := (SELECT CASE r ->> 'code' WHEN 'quote_requested' THEN 'Pidió cotización: "' || (r ->> 'text') || '"' ELSE 'Escribió: "' || (r ->> 'text') || '"' END
           FROM jsonb_array_elements(_p -> 'reasons') r WHERE r ->> 'code' IN ('quote_requested', 'deadline') LIMIT 1);

  IF NEW.assigned_staff_id IS NOT NULL THEN
    PERFORM public.emit_commercial_notice(NEW.workshop_id, NEW.assigned_staff_id, 'commercial_new_request', ARRAY['new:' || NEW.id],
      'Urgente: ' || coalesce(_client, 'cliente nuevo'), '',
      left(coalesce(_why, 'Lead urgente'), 220) || '. Tienes ' || public.hours_text(coalesce((SELECT cs.urgent_attention_hours FROM public.commercial_settings cs WHERE cs.workshop_id = NEW.workshop_id), 2)) || ' horas hábiles para atenderlo.',
      '/leads?lead=' || NEW.id, '');
  ELSE
    FOR _admin IN SELECT p.id FROM public.profiles p WHERE p.workshop_id = NEW.workshop_id AND p.role = 'ADMIN' LOOP
      PERFORM public.emit_commercial_notice(NEW.workshop_id, _admin.id, 'commercial_unassigned', ARRAY['unassigned:' || NEW.id],
        'Lead urgente sin vendedor: ' || coalesce(_client, 'cliente nuevo'), '',
        left(coalesce(_why, 'Lead urgente'), 220) || '. Asígnalo en Solicitudes.', '/requests', '');
    END LOOP;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- An alert must never block creating or assigning the request.
  RAISE WARNING 'notify_urgent_lead: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS service_requests_urgent_lead ON public.service_requests;
CREATE TRIGGER service_requests_urgent_lead
  AFTER INSERT OR UPDATE OF assigned_staff_id ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_urgent_lead();

-- ---------------------------------------------------------------------------
-- The 10-minute job, same as before plus the attention deadline for urgent
-- leads; seller notices now open the lead in "Mis leads".
CREATE OR REPLACE FUNCTION public.run_commercial_alerts(_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _w record;
  _s record;
  _g record;
  _admin record;
  _local timestamp;
  _day date;
  _dow integer;
  _working boolean;
  _hours integer;
  _followup_days integer := 5;
  _unassigned_hours integer := 4;
  _sent integer := 0;
  _msg text;
  _parts text[];
BEGIN
  FOR _w IN
    SELECT w.id, coalesce(cs.timezone, 'America/Santiago') AS tz,
           coalesce(cs.business_days, '{1,2,3,4,5}') AS days,
           coalesce(cs.business_opens_at, '09:00') AS opens, coalesce(cs.business_closes_at, '18:00') AS closes,
           coalesce(cs.unquoted_lead_alert_hours, 48) AS unquoted_hours,
           cs.discount_approval_threshold AS discount_limit,
           coalesce(cs.urgent_attention_hours, 2) AS sla_hours
    FROM public.workshops w
    LEFT JOIN public.commercial_settings cs ON cs.workshop_id = w.id
    WHERE (w.features ->> 'commercial')::boolean IS TRUE
  LOOP
    _local := _now AT TIME ZONE _w.tz;
    _day := _local::date;
    _dow := extract(isodow FROM _local)::integer;
    _working := _dow = ANY (_w.days) AND _local::time >= _w.opens AND _local::time < _w.closes;
    _hours := _w.unquoted_hours;

    IF _working THEN
      -- Seller: new requests assigned in the last 3 days.
      FOR _g IN
        SELECT staff_id, array_agg('new:' || request_id ORDER BY coalesce(assigned_at, created_at)) AS keys,
               array_agg(client ORDER BY coalesce(assigned_at, created_at)) AS clients,
               (array_agg(request_id ORDER BY coalesce(assigned_at, created_at)))[1] AS first_id
        FROM public.commercial_open_work(_w.id) AS _work
        WHERE staff_id IS NOT NULL AND quote_status IS NULL AND quoted_at IS NULL
          AND coalesce(assigned_at, created_at) >= _now - interval '3 days'
          AND NOT EXISTS (SELECT 1 FROM public.commercial_alert_log l WHERE l.user_id = _work.staff_id AND l.alert_key = 'new:' || _work.request_id)
        GROUP BY staff_id
      LOOP
        _sent := _sent + public.emit_commercial_notice(_w.id, _g.staff_id, 'commercial_new_request', _g.keys,
          'Nueva solicitud: ' || _g.clients[1],
          'Tienes {n} solicitudes nuevas',
          CASE WHEN array_length(_g.keys, 1) = 1 THEN 'Revisa la guía "Antes de llamar" y contáctalo.'
               ELSE public.names_phrase(_g.clients) || '. Revisa la guía "Antes de llamar" y contáctalos.' END,
          '/leads?lead=' || _g.first_id, '/leads');
      END LOOP;

      -- Seller: clients waiting for a quote beyond the limit.
      FOR _g IN
        SELECT staff_id, array_agg('waiting:' || request_id ORDER BY created_at) AS keys,
               array_agg(client ORDER BY created_at) AS clients,
               (array_agg(request_id ORDER BY created_at))[1] AS first_id,
               sum(amount) AS money, bool_or(amount_is_estimate) OR count(amount) < count(*) AS estimate
        FROM public.commercial_open_work(_w.id) AS _work
        WHERE staff_id IS NOT NULL
          AND (quote_status IN ('draft', 'issued') OR (quote_status IS NULL AND quoted_at IS NULL))
          AND created_at < _now - make_interval(hours => _hours)
          AND NOT EXISTS (SELECT 1 FROM public.commercial_alert_log l WHERE l.user_id = _work.staff_id AND l.alert_key = 'waiting:' || _work.request_id)
        GROUP BY staff_id
      LOOP
        _sent := _sent + public.emit_commercial_notice(_w.id, _g.staff_id, 'commercial_waiting', _g.keys,
          _g.clients[1] || ' espera tu cotización hace más de ' || _hours || ' horas',
          '{n} clientes esperan tu cotización hace más de ' || _hours || ' horas',
          CASE WHEN array_length(_g.keys, 1) = 1 THEN '' ELSE public.names_phrase(_g.clients) || '. ' END ||
            CASE WHEN coalesce(_g.money, 0) > 0
              THEN 'Hay ' || CASE WHEN _g.estimate THEN 'cerca de ' ELSE '' END || public.clp_text(_g.money) || CASE WHEN _g.estimate THEN ' (estimado)' ELSE '' END || ' en juego.'
              ELSE 'Mientras más espera, más se enfría.' END,
          '/leads?lead=' || _g.first_id, '/leads');
      END LOOP;

      -- Seller: quotes sent with no answer.
      FOR _g IN
        SELECT staff_id, array_agg('followup:' || coalesce(quote_id::text, request_id::text) ORDER BY coalesce(sent_at, quoted_at)) AS keys,
               array_agg(coalesce(quote_number || ' a ', '') || client ORDER BY coalesce(sent_at, quoted_at)) AS items,
               (array_agg(request_id ORDER BY coalesce(sent_at, quoted_at)))[1] AS first_id
        FROM public.commercial_open_work(_w.id) AS _work
        WHERE staff_id IS NOT NULL
          AND (quote_status = 'sent' OR (quote_status IS NULL AND quoted_at IS NOT NULL))
          AND coalesce(sent_at, quoted_at) < _now - make_interval(days => _followup_days)
          AND NOT EXISTS (SELECT 1 FROM public.commercial_alert_log l WHERE l.user_id = _work.staff_id
                          AND l.alert_key = 'followup:' || coalesce(_work.quote_id::text, _work.request_id::text))
        GROUP BY staff_id
      LOOP
        _sent := _sent + public.emit_commercial_notice(_w.id, _g.staff_id, 'commercial_followup', _g.keys,
          'Tu cotización ' || _g.items[1] || ' lleva ' || _followup_days || ' días sin respuesta',
          '{n} cotizaciones llevan más de ' || _followup_days || ' días sin respuesta',
          CASE WHEN array_length(_g.keys, 1) = 1 THEN 'Buen momento para hacer seguimiento.'
               ELSE public.names_phrase(_g.items) || '. Buen momento para hacer seguimiento.' END,
          '/leads?lead=' || _g.first_id, '/leads');
      END LOOP;

      -- Urgent leads (asked for a quote or gave a deadline) not attended within
      -- the promised business hours: remind the seller and tell the admins.
      FOR _g IN
        SELECT o.request_id, o.client, o.staff_id, o.staff_name,
               public.business_hours_between(_w.id, coalesce(o.assigned_at, o.created_at), _now) AS bh
        FROM public.commercial_open_work(_w.id) AS o
        JOIN public.service_requests sr ON sr.id = o.request_id
        WHERE sr.first_contact_at IS NULL AND o.status = 'new'
          AND o.created_at >= _now - interval '3 days'
          AND (public.lead_priority(o.request_id) ->> 'urgent')::boolean
      LOOP
        IF _g.bh > _w.sla_hours THEN
          IF _g.staff_id IS NOT NULL THEN
            _sent := _sent + public.emit_commercial_notice(_w.id, _g.staff_id, 'commercial_sla', ARRAY['sla:' || _g.request_id],
              'Sigue pendiente: ' || _g.client || ' (urgente)', '',
              'Lleva ' || greatest(round(_g.bh), 1)::int || ' horas hábiles sin atención; el plazo es ' || public.hours_text(_w.sla_hours) || '. Escríbele, cotiza o cambia su estado.',
              '/leads?lead=' || _g.request_id, '');
          END IF;
          FOR _admin IN SELECT p.id FROM public.profiles p WHERE p.workshop_id = _w.id AND p.role = 'ADMIN' AND p.id IS DISTINCT FROM _g.staff_id LOOP
            _sent := _sent + public.emit_commercial_notice(_w.id, _admin.id, 'commercial_sla', ARRAY['sla:' || _g.request_id],
              coalesce(_g.staff_name, 'Nadie') || ' no ha atendido a ' || _g.client, '',
              'Lead urgente hace ' || greatest(round(_g.bh), 1)::int || ' horas hábiles; el plazo es ' || public.hours_text(_w.sla_hours) || '.',
              '/leads?lead=' || _g.request_id, '');
          END LOOP;
        END IF;
      END LOOP;

      -- Admins: requests nobody took, and discounts over the limit.
      FOR _admin IN SELECT p.id FROM public.profiles p WHERE p.workshop_id = _w.id AND p.role = 'ADMIN' LOOP
        SELECT array_agg('unassigned:' || request_id ORDER BY created_at) AS keys,
               array_agg(client || coalesce(' (' || zone_label || ')', '') ORDER BY created_at) AS clients
          INTO _g
        FROM public.commercial_open_work(_w.id) AS _work
        WHERE staff_id IS NULL AND created_at < _now - make_interval(hours => _unassigned_hours)
          AND NOT EXISTS (SELECT 1 FROM public.commercial_alert_log l WHERE l.user_id = _admin.id AND l.alert_key = 'unassigned:' || _work.request_id);
        IF _g.keys IS NOT NULL THEN
          _sent := _sent + public.emit_commercial_notice(_w.id, _admin.id, 'commercial_unassigned', _g.keys,
            _g.clients[1] || ' lleva más de ' || _unassigned_hours || ' horas sin vendedor',
            '{n} solicitudes llevan más de ' || _unassigned_hours || ' horas sin vendedor',
            CASE WHEN array_length(_g.keys, 1) = 1 THEN 'Asígnala en Solicitudes.'
                 ELSE public.names_phrase(_g.clients) || '. Asígnalas en Solicitudes.' END, '/requests', '/requests');
        END IF;

        FOR _g IN
          SELECT q.id AS quote_id, q.quote_number, q.max_discount_pct, q.service_request_id, p.full_name AS staff_name
          FROM public.quotes q
          LEFT JOIN public.profiles p ON p.id = q.issued_by
          WHERE q.workshop_id = _w.id AND q.discount_over_threshold AND q.status NOT IN ('draft', 'void')
            AND q.issued_at >= _now - interval '7 days'
            AND NOT EXISTS (SELECT 1 FROM public.commercial_alert_log l WHERE l.user_id = _admin.id AND l.alert_key = 'discount:' || q.id)
        LOOP
          _sent := _sent + public.emit_commercial_notice(_w.id, _admin.id, 'commercial_discount', ARRAY['discount:' || _g.quote_id],
            coalesce(_g.staff_name, 'Un vendedor') || ' dio ' || round(_g.max_discount_pct)::text || '% de descuento en la ' || _g.quote_number,
            '', 'El tope permitido es ' || coalesce(round(_w.discount_limit)::text, '—') || '%. Revisa si corresponde.',
            CASE WHEN _g.service_request_id IS NOT NULL THEN '/leads?lead=' || _g.service_request_id ELSE '/commercial-summary' END, '');
        END LOOP;
      END LOOP;
    END IF;

    -- Digests on business days: 8:30 (sellers and admins) and 17:00 (admins).
    IF _dow = ANY (_w.days) THEN
      IF _local::time >= '08:30' AND _local::time < '12:00' THEN
        -- Seller's day.
        FOR _s IN
          SELECT staff_id,
                 count(*) FILTER (WHERE quote_status IN ('draft', 'issued') OR (quote_status IS NULL AND quoted_at IS NULL)) AS to_quote,
                 count(*) FILTER (WHERE (quote_status IN ('draft', 'issued') OR (quote_status IS NULL AND quoted_at IS NULL))
                                  AND created_at < _now - make_interval(hours => _hours)) AS late,
                 count(*) FILTER (WHERE quote_status = 'sent' OR (quote_status IS NULL AND quoted_at IS NOT NULL)) AS follow
          FROM public.commercial_open_work(_w.id) AS _work WHERE staff_id IS NOT NULL GROUP BY staff_id
        LOOP
          IF _s.to_quote + _s.follow > 0 THEN
            _parts := ARRAY[]::text[];
            IF _s.to_quote > 0 THEN _parts := _parts || (_s.to_quote || ' por cotizar' || CASE WHEN _s.late > 0 THEN ' (' || _s.late || CASE WHEN _s.late = 1 THEN ' atrasada)' ELSE ' atrasadas)' END ELSE '' END); END IF;
            IF _s.follow > 0 THEN _parts := _parts || (_s.follow || ' para seguimiento'); END IF;
            _sent := _sent + public.emit_commercial_notice(_w.id, _s.staff_id, 'commercial_my_day', ARRAY['myday:' || _day],
              'Tu día: ' || array_to_string(_parts, ', '), '', 'Empieza por las atrasadas. Todo está en Mi día.', '/my-day', '');
          END IF;
        END LOOP;
      END IF;

      IF (_local::time >= '08:30' AND _local::time < '12:00') OR (_local::time >= '17:00' AND _local::time < '23:00') THEN
        -- Admin summary: morning = what needs attention; afternoon = how the day went.
        _parts := ARRAY[]::text[];
        IF _local::time >= '17:00' THEN
          SELECT count(*) AS n INTO _g FROM public.service_requests sr WHERE sr.workshop_id = _w.id AND (sr.created_at AT TIME ZONE _w.tz)::date = _day;
          _parts := _parts || ('hoy ' || CASE WHEN _g.n = 1 THEN 'entró 1 solicitud' ELSE 'entraron ' || _g.n || ' solicitudes' END);
          SELECT count(*) AS n INTO _g FROM public.service_requests sr WHERE sr.workshop_id = _w.id AND sr.quoted_at IS NOT NULL AND (sr.quoted_at AT TIME ZONE _w.tz)::date = _day;
          _parts := _parts || (CASE WHEN _g.n = 1 THEN 'se envió 1 cotización' ELSE 'se enviaron ' || _g.n || ' cotizaciones' END);
          SELECT count(*) AS n, coalesce(sum(q.net_total), 0) AS total INTO _g
          FROM public.quotes q WHERE q.workshop_id = _w.id AND q.status = 'accepted' AND (q.closed_at AT TIME ZONE _w.tz)::date = _day;
          IF _g.n > 0 THEN _parts := _parts || (CASE WHEN _g.n = 1 THEN 'se ganó 1 venta' ELSE 'se ganaron ' || _g.n || ' ventas' END || ' por ' || public.clp_text(_g.total) || ' neto'); END IF;
        END IF;

        SELECT count(*) AS n, string_agg(DISTINCT coalesce(staff_name, '?'), ', ') AS who, sum(amount) AS money INTO _g
        FROM public.commercial_open_work(_w.id) AS _work WHERE staff_id IS NOT NULL
          AND (quote_status IN ('draft', 'issued') OR (quote_status IS NULL AND quoted_at IS NULL))
          AND created_at < _now - make_interval(hours => _hours);
        IF _g.n > 0 THEN _parts := _parts || (_g.n || CASE WHEN _g.n = 1 THEN ' cliente espera' ELSE ' clientes esperan' END || ' cotización hace más de ' || _hours || ' h (' || _g.who || ')'
          || CASE WHEN coalesce(_g.money, 0) > 0 THEN ', cerca de ' || public.clp_text(_g.money) ELSE '' END); END IF;

        SELECT count(*) AS n INTO _g FROM public.commercial_open_work(_w.id) AS _work WHERE staff_id IS NULL AND created_at < _now - make_interval(hours => _unassigned_hours);
        IF _g.n > 0 THEN _parts := _parts || (_g.n || CASE WHEN _g.n = 1 THEN ' solicitud sin vendedor' ELSE ' solicitudes sin vendedor' END); END IF;

        SELECT count(*) AS n INTO _g FROM public.commercial_open_work(_w.id) AS _work
        WHERE (quote_status = 'sent' OR (quote_status IS NULL AND quoted_at IS NOT NULL))
          AND coalesce(sent_at, quoted_at) < _now - make_interval(days => _followup_days);
        IF _g.n > 0 THEN _parts := _parts || (_g.n || CASE WHEN _g.n = 1 THEN ' cotización sin respuesta' ELSE ' cotizaciones sin respuesta' END || ' hace más de ' || _followup_days || ' días'); END IF;

        _msg := CASE WHEN array_length(_parts, 1) IS NULL THEN 'Todo al día: nadie espera cotización y no hay seguimientos atrasados.'
                     ELSE upper(left(array_to_string(_parts, ' · '), 1)) || substr(array_to_string(_parts, ' · '), 2) || '.' END;

        FOR _admin IN SELECT p.id FROM public.profiles p WHERE p.workshop_id = _w.id AND p.role = 'ADMIN' LOOP
          _sent := _sent + public.emit_commercial_notice(_w.id, _admin.id, 'commercial_summary',
            ARRAY['summary:' || CASE WHEN _local::time >= '17:00' THEN 'pm' ELSE 'am' END || ':' || _day],
            CASE WHEN _local::time >= '17:00' THEN 'Cierre del día' ELSE 'Resumen de la mañana' END, '', _msg, '/commercial-summary', '');
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sent', _sent, 'ran_at', _now);
END;
$$;

REVOKE ALL ON FUNCTION public.run_commercial_alerts(timestamptz) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Mis leads", same as before plus priority and attention facts.
CREATE OR REPLACE FUNCTION public.commercial_lead_inbox(_scope text DEFAULT 'me', _staff uuid DEFAULT NULL, _days integer DEFAULT 60)
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
  _settings record;
BEGIN
  SELECT p.workshop_id, p.role::text INTO _workshop, _role FROM public.profiles p WHERE p.id = _uid;
  IF _workshop IS NULL THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workshops w WHERE w.id = _workshop AND (w.features ->> 'commercial')::boolean IS TRUE) THEN
    RAISE EXCEPTION 'Módulo comercial no activo' USING ERRCODE = '42501';
  END IF;
  IF _scope NOT IN ('me', 'team') THEN RAISE EXCEPTION 'Alcance inválido' USING ERRCODE = '22023'; END IF;
  IF _scope = 'team' AND _role NOT IN ('ADMIN', 'SUPERADMIN') THEN
    RAISE EXCEPTION 'Solo un administrador ve los leads del equipo' USING ERRCODE = '42501';
  END IF;
  _days := least(greatest(coalesce(_days, 60), 7), 365);
  SELECT coalesce(cs.unquoted_lead_alert_hours, 48) AS unquoted_hours INTO _settings
  FROM public.commercial_settings cs WHERE cs.workshop_id = _workshop;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'scope', _scope,
    'unquoted_hours', coalesce(_settings.unquoted_hours, 48),
    'followup_days', 5,
    'sla_hours', coalesce((SELECT cs.urgent_attention_hours FROM public.commercial_settings cs WHERE cs.workshop_id = _workshop), 2),
    'leads', coalesce((
      SELECT jsonb_agg(row_to_json(l) ORDER BY l.created_at DESC)
      FROM (
        SELECT sr.id, sr.contact_id, sr.status::text AS status, sr.auto_created, sr.created_at, sr.assigned_at, sr.quoted_at, sr.closed_at,
               c.name AS client, c.company_name AS company, c.email AS client_email, c.phone AS client_phone,
               z.label AS zone_label, sr.assigned_staff_id AS staff_id, p.full_name AS staff_name,
               q.id AS quote_id, q.status AS quote_status, q.quote_number, q.sent_at, q.net_total AS quote_net,
               est.amount AS catalog_amount,
               em.email_count, em.unread_in, em.last_email_at, em.last_direction, em.last_preview, em.last_from_name,
               public.lead_priority(sr.id) AS priority,
               sr.first_contact_at,
               CASE WHEN sr.first_contact_at IS NULL AND sr.status = 'new'
                    THEN public.business_hours_between(sr.workshop_id, coalesce(sr.assigned_at, sr.created_at), now()) END AS unattended_business_hours
        FROM public.service_requests sr
        JOIN public.contacts c ON c.id = sr.contact_id
        LEFT JOIN public.workshop_zones z ON z.workshop_id = sr.workshop_id AND z.key = c.zone
        LEFT JOIN public.profiles p ON p.id = sr.assigned_staff_id
        LEFT JOIN LATERAL (
          SELECT q.id, q.status, q.quote_number, q.sent_at, q.net_total
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
        LEFT JOIN LATERAL (
          SELECT count(*) AS email_count,
                 count(*) FILTER (WHERE ce.direction = 'in' AND ce.read_at IS NULL) AS unread_in,
                 max(ce.sent_at) AS last_email_at,
                 (array_agg(ce.direction ORDER BY ce.sent_at DESC))[1] AS last_direction,
                 left((array_agg(ce.body_text ORDER BY ce.sent_at DESC))[1], 160) AS last_preview,
                 (array_agg(ce.from_name ORDER BY ce.sent_at DESC))[1] AS last_from_name
          FROM public.contact_emails ce
          WHERE ce.contact_id = sr.contact_id
        ) em ON true
        WHERE sr.workshop_id = _workshop
          AND (CASE WHEN _scope = 'me' THEN sr.assigned_staff_id = _uid ELSE (_staff IS NULL OR sr.assigned_staff_id = _staff) END)
          AND (sr.status NOT IN ('done', 'lost') OR coalesce(sr.closed_at, sr.updated_at, sr.created_at) >= now() - make_interval(days => _days))
      ) l
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commercial_lead_inbox(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_lead_inbox(text, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- "Interesados": clients with questions or asking prices, active in the last
-- 14 days, with no open request (and none closed in the last 30 days).
-- Sellers see their zone; admins see everything.
CREATE OR REPLACE FUNCTION public.commercial_interested()
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
  _zone text;
BEGIN
  SELECT p.workshop_id, p.role::text INTO _workshop, _role FROM public.profiles p WHERE p.id = _uid;
  IF _workshop IS NULL THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workshops w WHERE w.id = _workshop AND (w.features ->> 'commercial')::boolean IS TRUE) THEN
    RAISE EXCEPTION 'Módulo comercial no activo' USING ERRCODE = '42501';
  END IF;
  _zone := public.current_staff_zone();

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(i) ORDER BY i.lead_score DESC NULLS LAST, i.last_inbound_at DESC)
    FROM (
      SELECT c.id AS contact_id, c.name AS client, c.company_name AS company, c.phone, c.email,
             z.label AS zone_label, c.detected_intent AS intent, c.lead_score, c.lead_score_reasoning,
             last_in.at AS last_inbound_at, last_in.text AS last_inbound_text, last_in.conversation_id,
             (SELECT array_agg(DISTINCT e.sku_normalized) FROM public.conversation_product_events e
               WHERE e.contact_id = c.id AND e.sku_normalized IS NOT NULL) AS products
      FROM public.contacts c
      LEFT JOIN public.workshop_zones z ON z.workshop_id = c.workshop_id AND z.key = c.zone
      JOIN LATERAL (
        SELECT m.created_at AS at, left(m.text, 200) AS text, m.conversation_id
        FROM public.messages m JOIN public.conversations cv ON cv.id = m.conversation_id
        WHERE cv.contact_id = c.id AND m.direction = 'inbound'
        ORDER BY m.created_at DESC LIMIT 1
      ) last_in ON true
      WHERE c.workshop_id = _workshop
        AND (_zone IS NULL OR c.zone = _zone)
        AND last_in.at >= now() - interval '14 days'
        AND (c.detected_intent IN ('cotizacion', 'consulta', 'agendar_cita') OR coalesce(c.lead_score, 0) >= 60)
        AND NOT EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.contact_id = c.id
                        AND (sr.status NOT IN ('done', 'lost') OR coalesce(sr.closed_at, sr.updated_at) > now() - interval '30 days'))
      LIMIT 200
    ) i
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.commercial_interested() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_interested() TO authenticated;

-- A seller takes an interested client: it becomes their lead.
CREATE OR REPLACE FUNCTION public.take_interested_lead(_contact_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _c record;
  _conversation uuid;
  _channel text;
  _id uuid;
BEGIN
  SELECT c.id, c.workshop_id, c.lead_score_reasoning INTO _c FROM public.contacts c WHERE c.id = _contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_work_quote(_c.workshop_id, _c.id) OR public.get_user_workshop_id(_uid) IS DISTINCT FROM _c.workshop_id THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.contacts WHERE id = _contact_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.contact_id = _contact_id AND sr.status NOT IN ('done', 'lost')) THEN
    RAISE EXCEPTION 'Este cliente ya tiene una solicitud abierta' USING ERRCODE = '23505';
  END IF;

  SELECT cv.id INTO _conversation FROM public.conversations cv WHERE cv.contact_id = _contact_id
  ORDER BY cv.last_message_at DESC NULLS LAST LIMIT 1;
  SELECT m.channel INTO _channel FROM public.messages m WHERE m.conversation_id = _conversation AND m.direction = 'inbound'
  ORDER BY m.created_at DESC LIMIT 1;

  INSERT INTO public.service_requests (
    workshop_id, contact_id, conversation_id, service_category, description,
    urgency, status, source, assigned_staff_id, assigned_at, auto_created, qualification
  ) VALUES (
    _c.workshop_id, _contact_id, _conversation, 'Cotización de equipos',
    left('Tomado desde Interesados. ' || coalesce(_c.lead_score_reasoning, ''), 2000),
    'medium', 'new', CASE WHEN _channel = 'web' THEN 'web' ELSE 'whatsapp' END::public.request_source,
    _uid, now(), false,
    jsonb_build_object('created_by', 'seller', 'by', _uid, 'at', now(), 'reasons', '[]'::jsonb)
  )
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.take_interested_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.take_interested_lead(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Attention of urgent leads per seller, added to commercial_team_activity.
CREATE OR REPLACE FUNCTION public.seller_attention_stats(_workshop uuid, _staff uuid, _from timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH urgent AS (
    SELECT sr.id, coalesce(sr.assigned_at, sr.created_at) AS start_at, sr.first_contact_at
    FROM public.service_requests sr
    WHERE sr.workshop_id = _workshop AND sr.assigned_staff_id = _staff
      AND coalesce(sr.assigned_at, sr.created_at) >= _from
      AND coalesce((public.lead_priority(sr.id) ->> 'urgent')::boolean, false)
  ),
  timed AS (
    SELECT u.*, CASE WHEN u.first_contact_at IS NOT NULL THEN public.business_hours_between(_workshop, u.start_at, u.first_contact_at) END AS hours
    FROM urgent u
  )
  SELECT jsonb_build_object(
    'urgent_leads', count(*),
    'urgent_on_time', count(*) FILTER (WHERE hours IS NOT NULL AND hours <= coalesce((SELECT cs.urgent_attention_hours FROM public.commercial_settings cs WHERE cs.workshop_id = _workshop), 2)),
    'urgent_attend_median_hours', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours))::numeric, 1),
    'urgent_unattended', count(*) FILTER (WHERE first_contact_at IS NULL)
  ) FROM timed;
$$;

REVOKE ALL ON FUNCTION public.seller_attention_stats(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

DO $team$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_functiondef('public.commercial_team_activity(integer)'::regprocedure) INTO _def;
  IF position('seller_attention_stats' IN _def) = 0 THEN
    _def := replace(_def,
      '|| public.seller_email_stats(_workshop, x.staff_id, _from)',
      '|| public.seller_email_stats(_workshop, x.staff_id, _from) || public.seller_attention_stats(_workshop, x.staff_id, _from)');
    IF position('seller_attention_stats' IN _def) = 0 THEN
      RAISE EXCEPTION 'commercial_team_activity no tiene la forma esperada; no se modificó';
    END IF;
    EXECUTE _def;
  END IF;
END
$team$;
