-- F5 · T1: AI review of the emails sellers send to clients (commercial
-- module only). The scheduled task "email-review" (every 10 minutes) reviews
-- each email once: tone, whether it answered what the client asked, next
-- step, risky promises and one improvement. Sellers see their own reviews;
-- admins see everyone's and a summary per seller in "Cómo trabaja el equipo".
-- Additive: new table and functions, one cron job; commercial_team_activity
-- gains review keys.

CREATE TABLE IF NOT EXISTS public.email_reviews (
  contact_email_id uuid PRIMARY KEY REFERENCES public.contact_emails(id) ON DELETE CASCADE,
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  seller_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'done'
    CONSTRAINT email_reviews_status_valid CHECK (status IN ('done', 'failed')),
  tone smallint CONSTRAINT email_reviews_tone_range CHECK (tone BETWEEN 1 AND 5),
  tone_label text,
  answered text CONSTRAINT email_reviews_answered_valid CHECK (answered IN ('all', 'partial', 'none', 'nothing_asked')),
  unanswered text[] NOT NULL DEFAULT '{}',
  next_step boolean,
  next_step_text text,
  risks text[] NOT NULL DEFAULT '{}',
  strengths text[] NOT NULL DEFAULT '{}',
  improve text,
  summary text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_reviews_seller ON public.email_reviews (workshop_id, seller_id, created_at DESC);

ALTER TABLE public.email_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_reviews FROM anon, authenticated;
GRANT SELECT ON public.email_reviews TO authenticated;
GRANT ALL ON public.email_reviews TO service_role;

-- Visible where the email is visible (same seller / zone rules).
DROP POLICY IF EXISTS "email_reviews_read" ON public.email_reviews;
CREATE POLICY "email_reviews_read" ON public.email_reviews
  FOR SELECT TO authenticated
  USING (public.can_work_quote(workshop_id, contact_id));

-- Emails waiting for a review (service role only): seller emails of the last
-- 14 days with text, in commercial workshops, oldest first.
CREATE OR REPLACE FUNCTION public.pending_email_reviews(_limit integer DEFAULT 8)
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT x.id FROM (
    -- The same email seen in two mailboxes counts once.
    SELECT DISTINCT ON (coalesce(ce.internet_message_id, ce.id::text)) ce.id, ce.sent_at
    FROM public.contact_emails ce
    JOIN public.workshops w ON w.id = ce.workshop_id AND (w.features ->> 'commercial')::boolean IS TRUE
    WHERE ce.direction = 'out'
      AND ce.sent_at >= now() - interval '14 days'
      AND length(trim(ce.body_text)) >= 20
      AND NOT EXISTS (SELECT 1 FROM public.email_reviews r WHERE r.contact_email_id = ce.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.contact_emails twin
        JOIN public.email_reviews r2 ON r2.contact_email_id = twin.id
        WHERE ce.internet_message_id IS NOT NULL AND twin.internet_message_id = ce.internet_message_id AND twin.id <> ce.id
      )
    ORDER BY coalesce(ce.internet_message_id, ce.id::text), ce.sent_at
  ) x
  ORDER BY x.sent_at
  LIMIT least(greatest(coalesce(_limit, 8), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.pending_email_reviews(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pending_email_reviews(integer) TO service_role;

-- Review summary per seller, added to commercial_team_activity.
CREATE OR REPLACE FUNCTION public.seller_review_stats(_workshop uuid, _staff uuid, _from timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'reviewed', count(*),
    'tone_avg', round(avg(r.tone)::numeric, 1),
    'answered_all', count(*) FILTER (WHERE r.answered = 'all'),
    'answer_expected', count(*) FILTER (WHERE r.answered IN ('all', 'partial', 'none')),
    'with_next_step', count(*) FILTER (WHERE r.next_step),
    'with_risks', count(*) FILTER (WHERE cardinality(r.risks) > 0)
  )
  FROM public.email_reviews r
  JOIN public.contact_emails ce ON ce.id = r.contact_email_id
  WHERE r.workshop_id = _workshop AND r.seller_id = _staff AND r.status = 'done' AND ce.sent_at >= _from;
$$;

REVOKE ALL ON FUNCTION public.seller_review_stats(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

DO $team$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_functiondef('public.commercial_team_activity(integer)'::regprocedure) INTO _def;
  IF position('seller_review_stats' IN _def) = 0 THEN
    _def := replace(_def,
      '|| public.seller_attention_stats(_workshop, x.staff_id, _from)',
      '|| public.seller_attention_stats(_workshop, x.staff_id, _from) || public.seller_review_stats(_workshop, x.staff_id, _from)');
    IF position('seller_review_stats' IN _def) = 0 THEN
      RAISE EXCEPTION 'commercial_team_activity no tiene la forma esperada; no se modificó';
    END IF;
    EXECUTE _def;
  END IF;
END
$team$;

-- Every 10 minutes through the scheduled-tasks function.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'invoke_scheduled_task') THEN
    PERFORM cron.schedule('email-review', '3,13,23,33,43,53 * * * *', $job$SELECT public.invoke_scheduled_task('email-review')$job$);
  ELSE
    RAISE NOTICE 'pg_cron no está disponible: la revisión de correos no se programó';
  END IF;
END
$cron$;
