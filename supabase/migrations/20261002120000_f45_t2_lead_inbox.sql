-- F4.5 · T2: "Mis leads" (the seller's inbox), "Correos del equipo" (every
-- client email of the team, for admins) and email timings per seller.
-- Commercial module only. Additive: two new functions; commercial_team_activity
-- keeps every key it had and gains email keys.

-- ---------------------------------------------------------------------------
-- One row per lead (service request) with everything the list needs: stage
-- facts, quote, amount and the email activity with that client.
--   _scope = 'me'   → leads assigned to the caller.
--   _scope = 'team' → every lead of the business (admins), optionally one seller.
-- Open leads always; closed ones from the last _days days.
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
    'leads', coalesce((
      SELECT jsonb_agg(row_to_json(l) ORDER BY l.created_at DESC)
      FROM (
        SELECT sr.id, sr.contact_id, sr.status::text AS status, sr.auto_created, sr.created_at, sr.assigned_at, sr.quoted_at, sr.closed_at,
               c.name AS client, c.company_name AS company, c.email AS client_email, c.phone AS client_phone,
               z.label AS zone_label, sr.assigned_staff_id AS staff_id, p.full_name AS staff_name,
               q.id AS quote_id, q.status AS quote_status, q.quote_number, q.sent_at, q.net_total AS quote_net,
               est.amount AS catalog_amount,
               em.email_count, em.unread_in, em.last_email_at, em.last_direction, em.last_preview, em.last_from_name
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
-- "Correos del equipo" (admins): one row per client with email activity in
-- the last _days days, with who wrote, how many each way and whether the
-- client is waiting for an answer.
CREATE OR REPLACE FUNCTION public.commercial_email_threads(_staff uuid DEFAULT NULL, _days integer DEFAULT 30)
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
BEGIN
  SELECT p.workshop_id, p.role::text INTO _workshop, _role FROM public.profiles p WHERE p.id = _uid;
  IF _workshop IS NULL OR _role NOT IN ('ADMIN', 'SUPERADMIN') THEN
    RAISE EXCEPTION 'Solo un administrador ve los correos del equipo' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workshops w WHERE w.id = _workshop AND (w.features ->> 'commercial')::boolean IS TRUE) THEN
    RAISE EXCEPTION 'Módulo comercial no activo' USING ERRCODE = '42501';
  END IF;
  _days := least(greatest(coalesce(_days, 30), 7), 365);

  RETURN jsonb_build_object(
    'days', _days,
    'threads', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.last_email_at DESC)
      FROM (
        SELECT ce.contact_id, c.name AS client, c.company_name AS company,
               (array_agg(ce.service_request_id ORDER BY ce.sent_at DESC) FILTER (WHERE ce.service_request_id IS NOT NULL))[1] AS request_id,
               array_agg(DISTINCT pr.full_name) FILTER (WHERE pr.full_name IS NOT NULL) AS sellers,
               array_agg(DISTINCT ce.mailbox_user_id) FILTER (WHERE ce.mailbox_user_id IS NOT NULL) AS seller_ids,
               count(*) AS email_count,
               count(*) FILTER (WHERE ce.direction = 'out') AS sent,
               count(*) FILTER (WHERE ce.direction = 'in') AS received,
               count(*) FILTER (WHERE ce.sent_from_panel) AS from_panel,
               max(ce.sent_at) AS last_email_at,
               (array_agg(ce.direction ORDER BY ce.sent_at DESC))[1] AS last_direction,
               left((array_agg(ce.body_text ORDER BY ce.sent_at DESC))[1], 160) AS last_preview,
               (array_agg(ce.subject ORDER BY ce.sent_at DESC))[1] AS last_subject
        FROM public.contact_emails ce
        JOIN public.contacts c ON c.id = ce.contact_id
        LEFT JOIN public.profiles pr ON pr.id = ce.mailbox_user_id
        WHERE ce.workshop_id = _workshop AND ce.sent_at >= now() - make_interval(days => _days)
          AND (_staff IS NULL OR ce.mailbox_user_id = _staff)
        GROUP BY ce.contact_id, c.name, c.company_name
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commercial_email_threads(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_email_threads(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- Email timings per seller, added to commercial_team_activity: how long they
-- take to answer a client's email and how many are waiting now.
-- Answer time = from a client's email to the seller's next email to that same
-- client (from the same mailbox). "Waiting" = the client wrote last, over 24 h ago.
CREATE OR REPLACE FUNCTION public.seller_email_stats(_workshop uuid, _staff uuid, _from timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH mine AS (
    SELECT ce.* FROM public.contact_emails ce
    WHERE ce.workshop_id = _workshop AND ce.mailbox_user_id = _staff
  ),
  answers AS (
    SELECT i.id,
           extract(epoch FROM (
             SELECT min(o.sent_at) FROM mine o
             WHERE o.contact_id = i.contact_id AND o.direction = 'out' AND o.sent_at > i.sent_at
           ) - i.sent_at) / 3600 AS hours
    FROM mine i
    WHERE i.direction = 'in' AND i.sent_at >= _from
  ),
  last_per_client AS (
    SELECT DISTINCT ON (m.contact_id) m.contact_id, m.direction, m.sent_at
    FROM mine m ORDER BY m.contact_id, m.sent_at DESC
  )
  SELECT jsonb_build_object(
    'emails_sent', (SELECT count(*) FROM mine WHERE direction = 'out' AND sent_at >= _from),
    'emails_received', (SELECT count(*) FROM mine WHERE direction = 'in' AND sent_at >= _from),
    'email_reply_median_hours', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours))::numeric, 1) FROM answers WHERE hours IS NOT NULL),
    'email_reply_sample', (SELECT count(*) FROM answers WHERE hours IS NOT NULL),
    'emails_waiting_now', (SELECT count(*) FROM last_per_client WHERE direction = 'in' AND sent_at < now() - interval '24 hours')
  );
$$;

REVOKE ALL ON FUNCTION public.seller_email_stats(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

DO $team$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_functiondef('public.commercial_team_activity(integer)'::regprocedure) INTO _def;
  IF position('seller_email_stats' IN _def) = 0 THEN
    _def := replace(_def,
      'SELECT jsonb_agg(row_to_json(x) ORDER BY x.staff_name)',
      'SELECT jsonb_agg(to_jsonb(x) || public.seller_email_stats(_workshop, x.staff_id, _from) ORDER BY x.staff_name)');
    IF position('seller_email_stats' IN _def) = 0 THEN
      RAISE EXCEPTION 'commercial_team_activity no tiene la forma esperada; no se modificó';
    END IF;
    EXECUTE _def;
  END IF;
END
$team$;
