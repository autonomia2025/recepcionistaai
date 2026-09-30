-- F5 · T3: commercial metrics for the admin Dashboard (commercial module only).
--
-- North Star: pesos ganados con leads del bot en el período.
-- Definitions (the Dashboard explains each one with these same words):
--   Lead del bot   = solicitud creada por el bot (auto_created) o tomada desde
--                    "Interesados" (nació de una conversación con el bot).
--   Ganado         = solicitud en "Completada"; fecha = cierre de la cotización
--                    aceptada (o de la solicitud); monto = neto de la cotización
--                    aceptada o, si se cerró con el flujo antiguo, el monto anotado.
--   Contactado     = el vendedor actuó (first_contact_at).
--   Cotizado       = cotización enviada (quoted_at, sistema o botón antiguo).
--   Rápido         = cotizado dentro de 1 día hábil (horas hábiles de un día).
--   Embudo         = cohorte de leads que LLEGARON en el período.
--   Ganados, ROI   = ventas CERRADAS en el período (aunque el lead sea anterior).
--   ROI            = ganado ÷ costo del sistema en el período (cuota mensual
--                    prorrateada); con margen si está configurado.
-- Additive: one optional column (gross_margin_pct) and one function.

ALTER TABLE public.commercial_settings
  ADD COLUMN IF NOT EXISTS gross_margin_pct numeric(5, 2)
  CONSTRAINT commercial_settings_margin_range CHECK (gross_margin_pct IS NULL OR (gross_margin_pct > 0 AND gross_margin_pct <= 100));

CREATE OR REPLACE FUNCTION public.commercial_metrics(_from date, _to date)
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
  _tz text;
  _day_hours numeric;
  _sla numeric;
  _margin numeric;
  _limit numeric;
  _fee numeric;
  _days integer;
  _start timestamptz;
  _end timestamptz;
  _prev_start timestamptz;
  _prev_end timestamptz;
  _series_start timestamptz;
  _result jsonb;
BEGIN
  SELECT p.workshop_id, p.role::text INTO _workshop, _role FROM public.profiles p WHERE p.id = _uid;
  IF _workshop IS NULL OR _role NOT IN ('ADMIN', 'SUPERADMIN') THEN
    RAISE EXCEPTION 'Solo un administrador ve las métricas comerciales' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workshops w WHERE w.id = _workshop AND (w.features ->> 'commercial')::boolean IS TRUE) THEN
    RAISE EXCEPTION 'Módulo comercial no activo' USING ERRCODE = '42501';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from OR _to - _from > 400 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(cs.timezone, 'America/Santiago'),
         extract(epoch FROM coalesce(cs.business_closes_at, '18:00') - coalesce(cs.business_opens_at, '09:00')) / 3600,
         coalesce(cs.urgent_attention_hours, 2), cs.gross_margin_pct, cs.discount_approval_threshold
    INTO _tz, _day_hours, _sla, _margin, _limit
  FROM public.commercial_settings cs WHERE cs.workshop_id = _workshop;
  _tz := coalesce(_tz, 'America/Santiago');
  _day_hours := coalesce(_day_hours, 9);
  _sla := coalesce(_sla, 2);
  SELECT wb.monthly_fee_clp INTO _fee FROM public.workshop_billing wb WHERE wb.workshop_id = _workshop;

  _days := _to - _from + 1;
  _start := _from::timestamp AT TIME ZONE _tz;
  _end := (_to + 1)::timestamp AT TIME ZONE _tz;
  _prev_start := (_from - _days)::timestamp AT TIME ZONE _tz;
  _prev_end := _start;
  -- The weekly series covers the 8 weeks up to the end of the period.
  _series_start := least(_prev_start, (date_trunc('week', _to::timestamp) - interval '7 weeks') AT TIME ZONE _tz);

  WITH leads AS (
    SELECT sr.id, sr.contact_id, sr.status::text AS status, sr.created_at, sr.assigned_at, sr.first_contact_at, sr.quoted_at,
           sr.assigned_staff_id, coalesce(nullif(c.company_name, ''), c.name) AS client, c.zone, z.label AS zone_label,
           p.full_name AS seller,
           coalesce((public.lead_priority(sr.id) ->> 'urgent')::boolean, false) AS urgent,
           aq.net_total AS accepted_net, aq.closed_at AS accepted_at, aq.gross_subtotal, aq.discount_total,
           CASE WHEN sr.status = 'done' THEN coalesce(aq.closed_at, sr.closed_at, sr.updated_at) END AS won_at,
           CASE WHEN sr.status = 'done' THEN coalesce(aq.net_total, sr.quote_amount, 0) END AS won_amount,
           CASE WHEN sr.status = 'lost' THEN coalesce(sr.closed_at, sr.updated_at) END AS lost_at,
           sr.lost_reason
    FROM public.service_requests sr
    JOIN public.contacts c ON c.id = sr.contact_id
    LEFT JOIN public.workshop_zones z ON z.workshop_id = sr.workshop_id AND z.key = c.zone
    LEFT JOIN public.profiles p ON p.id = sr.assigned_staff_id
    LEFT JOIN LATERAL (
      SELECT q.net_total, q.closed_at, q.gross_subtotal, q.discount_total FROM public.quotes q
      WHERE q.service_request_id = sr.id AND q.status = 'accepted' ORDER BY q.closed_at DESC LIMIT 1
    ) aq ON true
    WHERE sr.workshop_id = _workshop
      AND (sr.auto_created OR sr.qualification ->> 'created_by' = 'seller')
  ),
  timed AS (
    SELECT l.*,
           CASE WHEN l.first_contact_at IS NOT NULL THEN public.business_hours_between(_workshop, coalesce(l.assigned_at, l.created_at), l.first_contact_at) END AS bh_contact,
           CASE WHEN l.quoted_at IS NOT NULL THEN public.business_hours_between(_workshop, coalesce(l.assigned_at, l.created_at), l.quoted_at) END AS bh_quote
    FROM leads l
    WHERE l.created_at >= _series_start OR l.won_at >= _series_start OR l.lost_at >= _prev_start OR l.status NOT IN ('done', 'lost')
  ),
  cohort AS (SELECT * FROM timed WHERE created_at >= _start AND created_at < _end),
  prev_cohort AS (SELECT * FROM timed WHERE created_at >= _prev_start AND created_at < _prev_end),
  won AS (SELECT * FROM timed WHERE won_at >= _start AND won_at < _end),
  prev_won AS (SELECT * FROM timed WHERE won_at >= _prev_start AND won_at < _prev_end),
  -- Quotes out with the client and not closed (all time, "now").
  pipeline AS (
    SELECT t.*, coalesce(sq.net_total, lq.quote_amount) AS open_amount, coalesce(sq.sent_at, t.quoted_at) AS sent_at
    FROM timed t
    LEFT JOIN LATERAL (
      SELECT q.net_total, q.sent_at FROM public.quotes q WHERE q.service_request_id = t.id AND q.status = 'sent' ORDER BY q.sent_at DESC LIMIT 1
    ) sq ON true
    JOIN public.service_requests lq ON lq.id = t.id
    WHERE t.status NOT IN ('done', 'lost') AND (sq.net_total IS NOT NULL OR t.quoted_at IS NOT NULL)
  ),
  weeks AS (
    SELECT generate_series(date_trunc('week', _to::timestamp) - interval '7 weeks', date_trunc('week', _to::timestamp), interval '1 week')::date AS week_start
  ),
  waiting AS (
    SELECT DISTINCT ON (ce.contact_id) ce.contact_id, ce.direction, ce.sent_at, ce.mailbox_user_id
    FROM public.contact_emails ce WHERE ce.workshop_id = _workshop
    ORDER BY ce.contact_id, ce.sent_at DESC
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', _from, 'to', _to, 'days', _days, 'prev_from', _from - _days, 'prev_to', _from - 1),
    'settings', jsonb_build_object('timezone', _tz, 'day_hours', round(_day_hours, 1), 'sla_hours', _sla, 'followup_days', 5,
                                   'margin_pct', _margin, 'monthly_fee', _fee, 'discount_limit', _limit),
    'north_star', jsonb_build_object(
      'amount', (SELECT coalesce(sum(won_amount), 0) FROM won),
      'count', (SELECT count(*) FROM won),
      'prev_amount', (SELECT coalesce(sum(won_amount), 0) FROM prev_won),
      'prev_count', (SELECT count(*) FROM prev_won),
      'weekly', (SELECT jsonb_agg(jsonb_build_object('week', w.week_start,
                   'amount', (SELECT coalesce(sum(t.won_amount), 0) FROM timed t WHERE (t.won_at AT TIME ZONE _tz)::date >= w.week_start AND (t.won_at AT TIME ZONE _tz)::date < w.week_start + 7),
                   'leads', (SELECT count(*) FROM timed t WHERE (t.created_at AT TIME ZONE _tz)::date >= w.week_start AND (t.created_at AT TIME ZONE _tz)::date < w.week_start + 7),
                   'fast', (SELECT count(*) FROM timed t WHERE (t.created_at AT TIME ZONE _tz)::date >= w.week_start AND (t.created_at AT TIME ZONE _tz)::date < w.week_start + 7 AND t.bh_quote <= _day_hours))
                 ORDER BY w.week_start) FROM weeks w)
    ),
    'leading', jsonb_build_object(
      'leads', (SELECT count(*) FROM cohort),
      'fast', (SELECT count(*) FROM cohort WHERE bh_quote <= _day_hours),
      'prev_leads', (SELECT count(*) FROM prev_cohort),
      'prev_fast', (SELECT count(*) FROM prev_cohort WHERE bh_quote <= _day_hours)
    ),
    'roi', jsonb_build_object(
      'sales', (SELECT coalesce(sum(won_amount), 0) FROM won),
      'cost', CASE WHEN _fee IS NOT NULL THEN round(_fee * _days / 30.4375) END,
      'margin', CASE WHEN _margin IS NOT NULL THEN round((SELECT coalesce(sum(won_amount), 0) FROM won) * _margin / 100) END,
      'conversations', (SELECT count(*) FROM public.conversations cv WHERE cv.workshop_id = _workshop AND cv.created_at >= _start AND cv.created_at < _end)
    ),
    'funnel', jsonb_build_object(
      'leads', (SELECT count(*) FROM cohort),
      'contacted', (SELECT count(*) FROM cohort WHERE first_contact_at IS NOT NULL),
      'quoted', (SELECT count(*) FROM cohort WHERE quoted_at IS NOT NULL),
      'won', (SELECT count(*) FROM cohort WHERE status = 'done'),
      'lost', (SELECT count(*) FROM cohort WHERE status = 'lost'),
      'won_amount', (SELECT coalesce(sum(won_amount), 0) FROM cohort WHERE status = 'done')
    ),
    'speed', jsonb_build_object(
      'contact_median', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY bh_contact))::numeric, 1) FROM cohort WHERE bh_contact IS NOT NULL),
      'contact_sample', (SELECT count(*) FROM cohort WHERE bh_contact IS NOT NULL),
      'quote_median', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY bh_quote))::numeric, 1) FROM cohort WHERE bh_quote IS NOT NULL),
      'quote_sample', (SELECT count(*) FROM cohort WHERE bh_quote IS NOT NULL),
      'urgent', (SELECT count(*) FROM cohort WHERE urgent),
      'urgent_on_time', (SELECT count(*) FROM cohort WHERE urgent AND bh_contact IS NOT NULL AND bh_contact <= _sla)
    ),
    'value', jsonb_build_object(
      'avg_ticket', (SELECT round(avg(won_amount)) FROM won WHERE won_amount > 0),
      'avg_discount_pct', (SELECT round(avg(100 * discount_total / nullif(gross_subtotal, 0))::numeric, 1) FROM won WHERE gross_subtotal > 0),
      'discount_sample', (SELECT count(*) FROM won WHERE gross_subtotal > 0),
      'cycle_median_days', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM won_at - created_at) / 86400))::numeric, 1) FROM won),
      'lost', (SELECT count(*) FROM timed WHERE lost_at >= _start AND lost_at < _end),
      'lost_reasons', (SELECT jsonb_agg(jsonb_build_object('reason', r, 'count', n) ORDER BY n DESC) FROM (
                         SELECT coalesce(lost_reason, 'Sin motivo') AS r, count(*) AS n FROM timed WHERE lost_at >= _start AND lost_at < _end GROUP BY 1) x)
    ),
    'pipeline', jsonb_build_object(
      'amount', (SELECT coalesce(sum(open_amount), 0) FROM pipeline),
      'count', (SELECT count(*) FROM pipeline),
      'cold_amount', (SELECT coalesce(sum(open_amount), 0) FROM pipeline WHERE sent_at < now() - interval '5 days'),
      'cold_count', (SELECT count(*) FROM pipeline WHERE sent_at < now() - interval '5 days')
    ),
    'health', jsonb_build_object(
      'clients_waiting', (SELECT count(*) FROM waiting WHERE direction = 'in' AND sent_at < now() - interval '24 hours'),
      'discount_over_limit', (SELECT count(*) FROM public.quotes q WHERE q.workshop_id = _workshop AND q.discount_over_threshold AND q.status NOT IN ('draft', 'void') AND q.issued_at >= _start AND q.issued_at < _end),
      'tone_avg', (SELECT round(avg(r.tone)::numeric, 1) FROM public.email_reviews r JOIN public.contact_emails ce ON ce.id = r.contact_email_id
                   WHERE r.workshop_id = _workshop AND r.status = 'done' AND ce.sent_at >= _start AND ce.sent_at < _end),
      'reviewed', (SELECT count(*) FROM public.email_reviews r JOIN public.contact_emails ce ON ce.id = r.contact_email_id
                   WHERE r.workshop_id = _workshop AND r.status = 'done' AND ce.sent_at >= _start AND ce.sent_at < _end),
      'actions_due', (SELECT count(*) FROM public.lead_next_actions a WHERE a.workshop_id = _workshop AND a.action_type <> 'wait'
                      AND a.due_date >= _from AND a.due_date <= least(_to, (now() AT TIME ZONE _tz)::date - 1)),
      'actions_followed', (SELECT count(*) FROM public.lead_next_actions a WHERE a.workshop_id = _workshop AND a.action_type <> 'wait'
                      AND a.due_date >= _from AND a.due_date <= least(_to, (now() AT TIME ZONE _tz)::date - 1) AND public.next_action_followed(a, _tz))
    ),
    'by_seller', (SELECT jsonb_agg(row_to_json(s) ORDER BY s.won_amount DESC, s.leads DESC) FROM (
      SELECT coalesce(t.seller, 'Sin vendedor') AS name,
             count(*) FILTER (WHERE t.created_at >= _start AND t.created_at < _end) AS leads,
             count(*) FILTER (WHERE t.created_at >= _start AND t.created_at < _end AND t.quoted_at IS NOT NULL) AS quoted,
             count(*) FILTER (WHERE t.created_at >= _start AND t.created_at < _end AND t.bh_quote <= _day_hours) AS fast,
             round((percentile_cont(0.5) WITHIN GROUP (ORDER BY t.bh_quote) FILTER (WHERE t.created_at >= _start AND t.created_at < _end))::numeric, 1) AS quote_median,
             count(*) FILTER (WHERE t.won_at >= _start AND t.won_at < _end) AS won,
             coalesce(sum(t.won_amount) FILTER (WHERE t.won_at >= _start AND t.won_at < _end), 0) AS won_amount
      FROM timed t GROUP BY 1
      HAVING count(*) FILTER (WHERE (t.created_at >= _start AND t.created_at < _end) OR (t.won_at >= _start AND t.won_at < _end)) > 0
    ) s),
    'by_zone', (SELECT jsonb_agg(row_to_json(s) ORDER BY s.won_amount DESC, s.leads DESC) FROM (
      SELECT coalesce(t.zone_label, 'Sin zona') AS name,
             count(*) FILTER (WHERE t.created_at >= _start AND t.created_at < _end) AS leads,
             count(*) FILTER (WHERE t.created_at >= _start AND t.created_at < _end AND t.quoted_at IS NOT NULL) AS quoted,
             count(*) FILTER (WHERE t.created_at >= _start AND t.created_at < _end AND t.bh_quote <= _day_hours) AS fast,
             round((percentile_cont(0.5) WITHIN GROUP (ORDER BY t.bh_quote) FILTER (WHERE t.created_at >= _start AND t.created_at < _end))::numeric, 1) AS quote_median,
             count(*) FILTER (WHERE t.won_at >= _start AND t.won_at < _end) AS won,
             coalesce(sum(t.won_amount) FILTER (WHERE t.won_at >= _start AND t.won_at < _end), 0) AS won_amount
      FROM timed t GROUP BY 1
      HAVING count(*) FILTER (WHERE (t.created_at >= _start AND t.created_at < _end) OR (t.won_at >= _start AND t.won_at < _end)) > 0
    ) s),
    -- The records behind each number (up to 200 each), for "ver los datos".
    'records', jsonb_build_object(
      'won', (SELECT jsonb_agg(jsonb_build_object('id', id, 'client', client, 'seller', seller, 'zone', zone_label, 'amount', won_amount, 'date', won_at) ORDER BY won_at DESC) FROM (SELECT * FROM won ORDER BY won_at DESC LIMIT 200) x),
      'leads', (SELECT jsonb_agg(jsonb_build_object('id', id, 'client', client, 'seller', seller, 'zone', zone_label, 'date', created_at,
                  'stage', CASE WHEN status = 'done' THEN 'Ganado' WHEN status = 'lost' THEN 'Perdido' WHEN quoted_at IS NOT NULL THEN 'Cotizado'
                                WHEN first_contact_at IS NOT NULL THEN 'Contactado' ELSE 'Sin atender' END,
                  'hours', bh_quote) ORDER BY created_at DESC) FROM (SELECT * FROM cohort ORDER BY created_at DESC LIMIT 200) x),
      'pipeline', (SELECT jsonb_agg(jsonb_build_object('id', id, 'client', client, 'seller', seller, 'zone', zone_label, 'amount', open_amount, 'date', sent_at,
                  'cold', sent_at < now() - interval '5 days') ORDER BY sent_at) FROM (SELECT * FROM pipeline ORDER BY sent_at LIMIT 200) x)
    )
  ) INTO _result;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.commercial_metrics(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_metrics(date, date) TO authenticated;
