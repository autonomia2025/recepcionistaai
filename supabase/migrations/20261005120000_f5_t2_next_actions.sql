-- F5 · T2: "Qué hacer ahora" on every open lead (next action with a date and
-- an argument) and whether each seller follows it (commercial module only).
--
-- The scheduled task "next-actions" (every 15 minutes) writes a suggestion
-- for each open, assigned lead that has none, or whose situation changed
-- since (client wrote, seller emailed, quote sent...). One active suggestion
-- per lead; older ones stay as history for adherence.
-- Followed = the seller marked it done, or acted on the lead (emailed the
-- client, sent a quote, moved it out of "Nueva") between the suggestion and
-- the end of its due date.
-- Additive: new table and functions, one cron job; commercial_team_activity
-- gains adherence keys.

CREATE TABLE IF NOT EXISTS public.lead_next_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  service_request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  action_type text NOT NULL
    CONSTRAINT lead_next_actions_type_valid CHECK (action_type IN ('call', 'email', 'send_quote', 'follow_up', 'visit', 'wait')),
  action text NOT NULL,
  due_date date NOT NULL,
  argument text,
  evidence text,
  reason text,
  basis_at timestamptz NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  done_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  done_note text,
  superseded_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_next_actions_one_active ON public.lead_next_actions (service_request_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_lead_next_actions_staff ON public.lead_next_actions (workshop_id, staff_id, due_date);

ALTER TABLE public.lead_next_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_next_actions FROM anon, authenticated;
GRANT SELECT ON public.lead_next_actions TO authenticated;
GRANT ALL ON public.lead_next_actions TO service_role;

DROP POLICY IF EXISTS "lead_next_actions_read" ON public.lead_next_actions;
CREATE POLICY "lead_next_actions_read" ON public.lead_next_actions
  FOR SELECT TO authenticated
  USING (public.can_work_quote(workshop_id, contact_id));

-- The seller marks the suggestion as done (e.g. after a phone call).
CREATE OR REPLACE FUNCTION public.complete_next_action(_id uuid, _note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _a public.lead_next_actions%ROWTYPE;
BEGIN
  SELECT * INTO _a FROM public.lead_next_actions WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sugerencia no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_work_quote(_a.workshop_id, _a.contact_id) THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501'; END IF;
  IF _a.done_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.lead_next_actions
    SET done_at = now(), done_by = auth.uid(), done_note = nullif(left(trim(coalesce(_note, '')), 500), '')
  WHERE id = _id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_next_action(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_next_action(uuid, text) TO authenticated;

-- Last thing that happened on a lead (client or seller), for "has the
-- situation changed since the suggestion?".
CREATE OR REPLACE FUNCTION public.lead_last_activity(_request_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT greatest(
    sr.created_at, sr.first_contact_at, sr.quoted_at,
    (SELECT max(ce.sent_at) FROM public.contact_emails ce WHERE ce.contact_id = sr.contact_id),
    (SELECT max(m.created_at) FROM public.messages m JOIN public.conversations cv ON cv.id = m.conversation_id
      WHERE cv.contact_id = sr.contact_id AND m.direction = 'inbound'),
    (SELECT max(greatest(q.issued_at, q.sent_at, q.closed_at)) FROM public.quotes q WHERE q.service_request_id = sr.id),
    (SELECT max(a.done_at) FROM public.lead_next_actions a WHERE a.service_request_id = sr.id)
  )
  FROM public.service_requests sr WHERE sr.id = _request_id;
$$;

-- Leads that need a (new) suggestion, urgent first. Service role only.
CREATE OR REPLACE FUNCTION public.leads_needing_next_action(_limit integer DEFAULT 8)
RETURNS TABLE (request_id uuid, basis_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT x.id, x.last_at
  FROM (
    SELECT sr.id, public.lead_last_activity(sr.id) AS last_at, a.basis_at AS current_basis, a.created_at AS current_at,
           coalesce((public.lead_priority(sr.id) ->> 'urgent')::boolean, false) AS urgent
    FROM public.service_requests sr
    JOIN public.workshops w ON w.id = sr.workshop_id AND (w.features ->> 'commercial')::boolean IS TRUE
    LEFT JOIN public.lead_next_actions a ON a.service_request_id = sr.id AND a.active
    WHERE sr.status NOT IN ('done', 'lost') AND sr.assigned_staff_id IS NOT NULL
  ) x
  WHERE x.current_basis IS NULL
     OR (x.last_at > x.current_basis + interval '1 minute' AND x.current_at < now() - interval '20 minutes')
  ORDER BY x.urgent DESC, x.last_at DESC
  LIMIT least(greatest(coalesce(_limit, 8), 1), 50);
$$;

-- Replaces the active suggestion of a lead with a new one (service role only).
CREATE OR REPLACE FUNCTION public.save_next_action(
  _request_id uuid, _basis_at timestamptz, _action_type text, _action text, _due date,
  _argument text, _evidence text, _reason text, _model text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _sr record;
  _id uuid;
BEGIN
  SELECT id, workshop_id, contact_id, assigned_staff_id INTO _sr FROM public.service_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.lead_next_actions SET active = false, superseded_at = now()
  WHERE service_request_id = _request_id AND active;
  INSERT INTO public.lead_next_actions (workshop_id, service_request_id, contact_id, staff_id, action_type, action, due_date, argument, evidence, reason, basis_at, model)
  VALUES (_sr.workshop_id, _request_id, _sr.contact_id, _sr.assigned_staff_id, _action_type, _action, _due, _argument, _evidence, _reason, _basis_at, _model)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.lead_last_activity(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leads_needing_next_action(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_next_action(uuid, timestamptz, text, text, date, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_last_activity(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_priority(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.leads_needing_next_action(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_next_action(uuid, timestamptz, text, text, date, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Adherence per seller: suggestions whose due date already passed (in the
-- window), and how many were followed on time.
CREATE OR REPLACE FUNCTION public.next_action_followed(_a public.lead_next_actions, _tz text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (_a.done_at IS NOT NULL AND (_a.done_at AT TIME ZONE _tz)::date <= _a.due_date)
    OR EXISTS (
      SELECT 1 FROM public.contact_emails ce
      WHERE ce.contact_id = _a.contact_id AND ce.direction = 'out' AND ce.sent_at >= _a.created_at
        AND (ce.sent_at AT TIME ZONE _tz)::date <= _a.due_date
    )
    OR EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.service_request_id = _a.service_request_id AND q.sent_at >= _a.created_at
        AND (q.sent_at AT TIME ZONE _tz)::date <= _a.due_date
    )
    OR EXISTS (
      SELECT 1 FROM public.service_requests sr
      WHERE sr.id = _a.service_request_id AND sr.first_contact_at >= _a.created_at
        AND (sr.first_contact_at AT TIME ZONE _tz)::date <= _a.due_date
    );
$$;

CREATE OR REPLACE FUNCTION public.seller_next_action_stats(_workshop uuid, _staff uuid, _from timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH s AS (SELECT coalesce((SELECT cs.timezone FROM public.commercial_settings cs WHERE cs.workshop_id = _workshop), 'America/Santiago') AS tz),
  due AS (
    SELECT a.done_at, public.next_action_followed(a, (SELECT tz FROM s)) AS followed
    FROM public.lead_next_actions a
    WHERE a.workshop_id = _workshop AND a.staff_id = _staff AND a.created_at >= _from
      AND a.action_type <> 'wait'
      AND a.due_date < (now() AT TIME ZONE (SELECT tz FROM s))::date
  )
  SELECT jsonb_build_object(
    'actions_due', count(*),
    'actions_followed', count(*) FILTER (WHERE followed),
    'actions_marked_done', count(*) FILTER (WHERE done_at IS NOT NULL)
  ) FROM due;
$$;

REVOKE ALL ON FUNCTION public.next_action_followed(public.lead_next_actions, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_next_action_stats(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

DO $team$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_functiondef('public.commercial_team_activity(integer)'::regprocedure) INTO _def;
  IF position('seller_next_action_stats' IN _def) = 0 THEN
    _def := replace(_def,
      '|| public.seller_review_stats(_workshop, x.staff_id, _from)',
      '|| public.seller_review_stats(_workshop, x.staff_id, _from) || public.seller_next_action_stats(_workshop, x.staff_id, _from)');
    IF position('seller_next_action_stats' IN _def) = 0 THEN
      RAISE EXCEPTION 'commercial_team_activity no tiene la forma esperada; no se modificó';
    END IF;
    EXECUTE _def;
  END IF;
END
$team$;

-- Every 15 minutes through the scheduled-tasks function.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'invoke_scheduled_task') THEN
    PERFORM cron.schedule('next-actions', '7,22,37,52 * * * *', $job$SELECT public.invoke_scheduled_task('next-actions')$job$);
  ELSE
    RAISE NOTICE 'pg_cron no está disponible: las próximas acciones no se programaron';
  END IF;
END
$cron$;
