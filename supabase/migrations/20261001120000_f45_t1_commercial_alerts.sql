-- F4.5 · T1: alerts that reach people on their own (commercial module only).
--
-- Every 10 minutes public.run_commercial_alerts() looks at the open work of
-- each commercial workshop and leaves notices in the panel bell:
--   seller → new requests assigned to them, clients waiting for a quote,
--            quotes sent with no answer, a morning digest (8:30).
--   admin  → requests nobody took, discounts over the limit, a summary at
--            8:30 and 17:00 (local time of Configuración comercial).
-- Each notice is sent once (commercial_alert_log) and grouped per person per
-- run, so nobody gets a flood. Push notices only go out on business days and
-- hours; what happens at night arrives when the day starts.
--
-- Additive: one nullable column on notifications (link), restrictive policies
-- that only affect the new personal notice types, new tables and functions,
-- one cron job. commercial_facts gains one key (quoted_at).

-- ---------------------------------------------------------------------------
-- Notifications: optional link, and personal notices only for their recipient.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link text;

-- Personal commercial notices (and the "client answered" notice from the mail
-- sync) are seen only by the person they are for. Every other notice keeps
-- being visible to the whole business, exactly as today.
DROP POLICY IF EXISTS "personal_notices_read" ON public.notifications;
CREATE POLICY "personal_notices_read" ON public.notifications
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (type LIKE 'commercial\_%' OR type = 'quote_reply') OR user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "personal_notices_update" ON public.notifications;
CREATE POLICY "personal_notices_update" ON public.notifications
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (type LIKE 'commercial\_%' OR type = 'quote_reply') OR user_id IS NULL OR user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- What was already notified to whom.
CREATE TABLE IF NOT EXISTS public.commercial_alert_log (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  alert_key text NOT NULL,
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, alert_key)
);
ALTER TABLE public.commercial_alert_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_alert_log FROM anon, authenticated;
GRANT ALL ON public.commercial_alert_log TO service_role;

-- $1.234.567
CREATE OR REPLACE FUNCTION public.clp_text(_value numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '$' || replace(to_char(round(coalesce(_value, 0)), 'FM999,999,999,999'), ',', '.');
$$;

-- "Juan Pérez, Ana Soto y 2 más"
CREATE OR REPLACE FUNCTION public.names_phrase(_names text[], _max integer DEFAULT 3)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN coalesce(array_length(_names, 1), 0) = 0 THEN ''
    WHEN array_length(_names, 1) = 1 THEN _names[1]
    WHEN array_length(_names, 1) <= _max THEN array_to_string(_names[1:array_length(_names, 1) - 1], ', ') || ' y ' || _names[array_length(_names, 1)]
    ELSE array_to_string(_names[1:_max], ', ') || ' y ' || (array_length(_names, 1) - _max) || ' más'
  END;
$$;

-- One notice to one person for a group of items, only with the items that
-- were not notified before. Returns how many new items it covered.
CREATE OR REPLACE FUNCTION public.emit_commercial_notice(
  _workshop uuid, _user uuid, _type text, _keys text[],
  _title_one text, _title_many text, _message text, _link_one text, _link_many text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _fresh text[];
  _n integer;
BEGIN
  WITH ins AS (
    INSERT INTO public.commercial_alert_log (user_id, alert_key, workshop_id)
    SELECT _user, k, _workshop FROM unnest(_keys) k
    ON CONFLICT DO NOTHING
    RETURNING alert_key
  )
  SELECT array_agg(alert_key) INTO _fresh FROM ins;
  _n := coalesce(array_length(_fresh, 1), 0);
  IF _n = 0 THEN RETURN 0; END IF;

  INSERT INTO public.notifications (workshop_id, user_id, type, title, message, link)
  VALUES (_workshop, _user, _type,
          CASE WHEN _n = 1 THEN _title_one ELSE replace(_title_many, '{n}', _n::text) END,
          _message,
          CASE WHEN _n = 1 THEN _link_one ELSE _link_many END);
  RETURN _n;
END;
$$;

-- ---------------------------------------------------------------------------
-- Open work of a workshop, one row per open request (same rules as the panel).
CREATE OR REPLACE FUNCTION public.commercial_open_work(_workshop uuid)
RETURNS TABLE (
  request_id uuid, client text, staff_id uuid, staff_name text, status text,
  created_at timestamptz, assigned_at timestamptz, quoted_at timestamptz, zone_label text,
  quote_id uuid, quote_status text, quote_number text, sent_at timestamptz,
  amount numeric, amount_is_estimate boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT sr.id, coalesce(nullif(c.company_name, ''), c.name), sr.assigned_staff_id, p.full_name, sr.status::text,
         sr.created_at, sr.assigned_at, sr.quoted_at, z.label,
         q.id, q.status, q.quote_number, q.sent_at,
         coalesce(q.net_total, est.amount), q.net_total IS NULL AND est.amount IS NOT NULL
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
  WHERE sr.workshop_id = _workshop AND sr.status NOT IN ('done', 'lost');
$$;

REVOKE ALL ON FUNCTION public.commercial_open_work(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_commercial_notice(uuid, uuid, text, text[], text, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The job. Safe to run any time; it only sends what was not sent.
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
           cs.discount_approval_threshold AS discount_limit
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
          '/my-day?request=' || _g.first_id, '/my-day');
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
          '/my-day?request=' || _g.first_id, '/my-day');
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
          '/my-day?request=' || _g.first_id, '/my-day');
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
            CASE WHEN _g.service_request_id IS NOT NULL THEN '/my-day?request=' || _g.service_request_id ELSE '/commercial-summary' END, '');
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
-- How each seller works (admins only): volume, speed to quote, what is late
-- right now and how the closes went, over the last _days days.
CREATE OR REPLACE FUNCTION public.commercial_team_activity(_days integer DEFAULT 30)
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
  _from timestamptz;
BEGIN
  SELECT p.workshop_id, p.role::text INTO _workshop, _role FROM public.profiles p WHERE p.id = _uid;
  IF _workshop IS NULL OR _role NOT IN ('ADMIN', 'SUPERADMIN') THEN
    RAISE EXCEPTION 'Solo un administrador ve la actividad del equipo' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workshops w WHERE w.id = _workshop AND (w.features ->> 'commercial')::boolean IS TRUE) THEN
    RAISE EXCEPTION 'Módulo comercial no activo' USING ERRCODE = '42501';
  END IF;
  _days := least(greatest(coalesce(_days, 30), 7), 180);
  _from := now() - make_interval(days => _days);
  SELECT coalesce(cs.unquoted_lead_alert_hours, 48) INTO _hours FROM public.commercial_settings cs WHERE cs.workshop_id = _workshop;
  _hours := coalesce(_hours, 48);

  RETURN jsonb_build_object(
    'days', _days,
    'unquoted_hours', _hours,
    'followup_days', 5,
    'sellers', coalesce((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.staff_name)
      FROM (
        SELECT p.id AS staff_id, p.full_name AS staff_name,
          (SELECT count(*) FROM public.service_requests sr
            WHERE sr.workshop_id = _workshop AND sr.assigned_staff_id = p.id AND coalesce(sr.assigned_at, sr.created_at) >= _from) AS assigned,
          (SELECT count(*) FROM public.service_requests sr
            WHERE sr.workshop_id = _workshop AND sr.assigned_staff_id = p.id AND coalesce(sr.assigned_at, sr.created_at) >= _from AND sr.quoted_at IS NOT NULL) AS quoted,
          (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM sr.quoted_at - coalesce(sr.assigned_at, sr.created_at)) / 3600))::numeric, 1)
            FROM public.service_requests sr
            WHERE sr.workshop_id = _workshop AND sr.assigned_staff_id = p.id AND sr.quoted_at >= _from
              AND sr.quoted_at >= coalesce(sr.assigned_at, sr.created_at)) AS median_hours_to_quote,
          (SELECT count(*) FROM public.service_requests sr
            WHERE sr.workshop_id = _workshop AND sr.assigned_staff_id = p.id AND sr.quoted_at >= _from
              AND sr.quoted_at >= coalesce(sr.assigned_at, sr.created_at)) AS speed_sample,
          (SELECT count(*) FROM public.service_requests sr
            WHERE sr.workshop_id = _workshop AND sr.assigned_staff_id = p.id AND sr.quoted_at >= now() - interval '7 days') AS quoted_last_7_days,
          (SELECT count(*) FROM public.commercial_open_work(_workshop) o WHERE o.staff_id = p.id) AS open_now,
          (SELECT count(*) FROM public.commercial_open_work(_workshop) o WHERE o.staff_id = p.id
            AND (o.quote_status IN ('draft', 'issued') OR (o.quote_status IS NULL AND o.quoted_at IS NULL))
            AND o.created_at < now() - make_interval(hours => _hours)) AS waiting_late_now,
          (SELECT count(*) FROM public.commercial_open_work(_workshop) o WHERE o.staff_id = p.id
            AND (o.quote_status = 'sent' OR (o.quote_status IS NULL AND o.quoted_at IS NOT NULL))
            AND coalesce(o.sent_at, o.quoted_at) < now() - interval '5 days') AS followup_late_now,
          (SELECT count(*) FROM public.quotes q JOIN public.service_requests sr ON sr.id = q.service_request_id
            WHERE q.workshop_id = _workshop AND sr.assigned_staff_id = p.id AND q.status = 'accepted' AND q.closed_at >= _from) AS won,
          (SELECT count(*) FROM public.quotes q JOIN public.service_requests sr ON sr.id = q.service_request_id
            WHERE q.workshop_id = _workshop AND sr.assigned_staff_id = p.id AND q.status = 'rejected' AND q.closed_at >= _from) AS lost,
          (SELECT coalesce(sum(q.net_total), 0) FROM public.quotes q JOIN public.service_requests sr ON sr.id = q.service_request_id
            WHERE q.workshop_id = _workshop AND sr.assigned_staff_id = p.id AND q.status = 'accepted' AND q.closed_at >= _from) AS won_amount,
          (SELECT count(*) FROM public.lead_call_guide_feedback f
            JOIN public.lead_call_guides g ON g.id = f.guide_id
            WHERE g.workshop_id = _workshop AND f.user_id = p.id AND f.updated_at >= _from) AS guide_feedback
        FROM public.profiles p
        WHERE p.workshop_id = _workshop AND p.role IN ('STAFF', 'ADMIN')
          AND (p.role = 'STAFF' OR EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.assigned_staff_id = p.id AND coalesce(sr.assigned_at, sr.created_at) >= _from))
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commercial_team_activity(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_team_activity(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- commercial_facts: add quoted_at so the panel knows a request quoted with the
-- older "Marcar cotización enviada" button is not "waiting for a quote".
DO $facts$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_functiondef('public.commercial_facts(text)'::regprocedure) INTO _def;
  IF position('''quoted_at''' IN _def) = 0 THEN
    _def := replace(_def, 'sr.id, sr.contact_id, sr.status::text AS status, sr.created_at, sr.assigned_at, sr.assigned_staff_id,',
                          'sr.id, sr.contact_id, sr.status::text AS status, sr.created_at, sr.assigned_at, sr.assigned_staff_id, sr.quoted_at,');
    _def := replace(_def, '''created_at'', o.created_at, ''assigned_at'', o.assigned_at,',
                          '''created_at'', o.created_at, ''assigned_at'', o.assigned_at, ''quoted_at'', o.quoted_at,');
    IF position('''quoted_at''' IN _def) = 0 OR position('sr.assigned_staff_id, sr.quoted_at,' IN _def) = 0 THEN
      RAISE EXCEPTION 'commercial_facts no tiene la forma esperada; no se modificó';
    END IF;
    EXECUTE _def;
  END IF;
END
$facts$;

-- ---------------------------------------------------------------------------
-- Every 10 minutes (pure SQL, no edge function involved).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('commercial-alerts', '*/10 * * * *', $job$SELECT public.run_commercial_alerts()$job$);
  ELSE
    RAISE NOTICE 'pg_cron no está disponible: las alertas no se programaron';
  END IF;
END
$cron$;
