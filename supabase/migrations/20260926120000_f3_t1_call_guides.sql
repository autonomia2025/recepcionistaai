-- F3 · Tarea 1 — Guía "Antes de llamar" por solicitud (solo agrega).
--
-- lead_call_guides: una guía por solicitud, escrita solo por la función
-- generate-call-guide (service role). La ve quien puede trabajar las
-- cotizaciones de ese cliente (módulo comercial + zona), igual que quotes.
-- lead_call_guide_feedback: 👍/👎 de cada persona sobre la guía, con comentario
-- opcional. Cada uno escribe solo el suyo.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.lead_call_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  service_request_id uuid NOT NULL UNIQUE REFERENCES public.service_requests(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  content jsonb NOT NULL,
  last_message_at timestamptz,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.lead_call_guide_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id uuid NOT NULL REFERENCES public.lead_call_guides(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  useful boolean NOT NULL,
  comment text CONSTRAINT call_guide_feedback_comment_length CHECK (comment IS NULL OR length(comment) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_guide_feedback_one_per_user UNIQUE (guide_id, user_id)
);

ALTER TABLE public.lead_call_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_call_guide_feedback ENABLE ROW LEVEL SECURITY;

-- Guides: read-only for people, written by the service role only.
REVOKE ALL ON public.lead_call_guides FROM anon, authenticated;
GRANT SELECT ON public.lead_call_guides TO authenticated;
GRANT ALL ON public.lead_call_guides TO service_role;

DROP POLICY IF EXISTS "call_guides_read" ON public.lead_call_guides;
CREATE POLICY "call_guides_read" ON public.lead_call_guides
  FOR SELECT TO authenticated
  USING (public.can_work_quote(workshop_id, contact_id));

-- Feedback: everyone who sees the guide reads its feedback; each person writes
-- only their own.
REVOKE ALL ON public.lead_call_guide_feedback FROM anon, authenticated;
GRANT SELECT, DELETE ON public.lead_call_guide_feedback TO authenticated;
GRANT INSERT (guide_id, useful, comment, updated_at) ON public.lead_call_guide_feedback TO authenticated;
-- guide_id is included because an upsert from the app rewrites every column it
-- sends; the policy still limits rows to the person's own opinions.
GRANT UPDATE (guide_id, useful, comment, updated_at) ON public.lead_call_guide_feedback TO authenticated;
GRANT ALL ON public.lead_call_guide_feedback TO service_role;

DROP POLICY IF EXISTS "call_guide_feedback_read" ON public.lead_call_guide_feedback;
CREATE POLICY "call_guide_feedback_read" ON public.lead_call_guide_feedback
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lead_call_guides g WHERE g.id = lead_call_guide_feedback.guide_id));

DROP POLICY IF EXISTS "call_guide_feedback_write_own" ON public.lead_call_guide_feedback;
CREATE POLICY "call_guide_feedback_write_own" ON public.lead_call_guide_feedback
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.lead_call_guides g WHERE g.id = lead_call_guide_feedback.guide_id));
