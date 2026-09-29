-- F4 · T1: send official quotes by email from the panel and bring the
-- customer's replies back to the request (commercial module only).
--
-- Mail goes out through Resend from a subdomain of the business (for example
-- cotizaciones.soc.cl), so the business's own mailbox is never touched. Every
-- email carries a reply address with a token; Resend receives the reply and
-- the resend-webhook function stores it here.
--
-- Additive only: new tables, new functions and restrictive storage policies for
-- a new folder. Nothing that exists today changes.

-- ---------------------------------------------------------------------------
-- Sending domain, one per workshop. Written only by the quote-email-domain
-- function (service role) after it talks to Resend.
CREATE TABLE IF NOT EXISTS public.workshop_email_domains (
  workshop_id uuid PRIMARY KEY REFERENCES public.workshops(id) ON DELETE CASCADE,
  domain text NOT NULL UNIQUE
    CONSTRAINT workshop_email_domains_domain_format
    CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  sender_local text NOT NULL DEFAULT 'cotizaciones'
    CONSTRAINT workshop_email_domains_sender_local_format
    CHECK (sender_local ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  provider_domain_id text,
  status text NOT NULL DEFAULT 'not_started',
  records jsonb NOT NULL DEFAULT '[]'::jsonb,
  checked_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workshop_email_domains IS
  'Dominio desde el que salen las cotizaciones por correo (Resend). Lo escribe solo la función quote-email-domain.';

DROP TRIGGER IF EXISTS update_workshop_email_domains_updated_at ON public.workshop_email_domains;
CREATE TRIGGER update_workshop_email_domains_updated_at
  BEFORE UPDATE ON public.workshop_email_domains
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workshop_email_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workshop_email_domains FROM anon, authenticated;
GRANT SELECT ON public.workshop_email_domains TO authenticated;
GRANT ALL ON public.workshop_email_domains TO service_role;

-- Everyone in the workshop may see whether email is ready (sellers need it to
-- know if the "Enviar por correo" button works).
DROP POLICY IF EXISTS "email_domains_read" ON public.workshop_email_domains;
CREATE POLICY "email_domains_read" ON public.workshop_email_domains
  FOR SELECT TO authenticated
  USING (workshop_id = public.get_user_workshop_id(auth.uid()) OR public.is_superadmin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Emails sent from the panel: the quote itself and later answers in the same
-- thread. Written only by send-quote-email / resend-webhook (service role).
CREATE TABLE IF NOT EXISTS public.quote_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  service_request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'quote'
    CONSTRAINT quote_emails_kind_valid CHECK (kind IN ('quote', 'answer')),
  sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  from_address text NOT NULL,
  reply_to_address text NOT NULL,
  to_addresses text[] NOT NULL,
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body_text text NOT NULL,
  attachment_name text,
  reply_token text NOT NULL
    CONSTRAINT quote_emails_reply_token_format CHECK (reply_token ~ '^[a-z0-9]{16,40}$'),
  message_id text,
  provider_email_id text UNIQUE,
  status text NOT NULL DEFAULT 'sending'
    CONSTRAINT quote_emails_status_valid
    CHECK (status IN ('sending', 'sent', 'delivered', 'delayed', 'bounced', 'complained', 'failed')),
  status_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_emails_quote ON public.quote_emails (quote_id, created_at);
CREATE INDEX IF NOT EXISTS idx_quote_emails_token ON public.quote_emails (reply_token);
CREATE INDEX IF NOT EXISTS idx_quote_emails_request ON public.quote_emails (service_request_id);

DROP TRIGGER IF EXISTS update_quote_emails_updated_at ON public.quote_emails;
CREATE TRIGGER update_quote_emails_updated_at
  BEFORE UPDATE ON public.quote_emails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Replies from the customer, received by Resend and matched by the token.
CREATE TABLE IF NOT EXISTS public.quote_email_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  quote_email_id uuid REFERENCES public.quote_emails(id) ON DELETE SET NULL,
  service_request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  provider_email_id text NOT NULL UNIQUE,
  message_id text,
  from_address text NOT NULL,
  from_name text,
  subject text,
  body_text text NOT NULL DEFAULT '',
  quoted_text text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  sender_verified boolean,
  received_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  read_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_email_replies_quote ON public.quote_email_replies (quote_id, received_at);
CREATE INDEX IF NOT EXISTS idx_quote_email_replies_unread ON public.quote_email_replies (workshop_id, received_at DESC) WHERE read_at IS NULL;

-- Both tables are visible exactly where the quote is visible (same seller /
-- zone rules as the quote itself, through the quotes policy).
ALTER TABLE public.quote_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_email_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quote_emails, public.quote_email_replies FROM anon, authenticated;
GRANT SELECT ON public.quote_emails, public.quote_email_replies TO authenticated;
GRANT ALL ON public.quote_emails, public.quote_email_replies TO service_role;

DROP POLICY IF EXISTS "quote_emails_read" ON public.quote_emails;
CREATE POLICY "quote_emails_read" ON public.quote_emails
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_emails.quote_id));

DROP POLICY IF EXISTS "quote_email_replies_read" ON public.quote_email_replies;
CREATE POLICY "quote_email_replies_read" ON public.quote_email_replies
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_email_replies.quote_id));

-- Marks the customer's replies to a quote as read by the caller.
CREATE OR REPLACE FUNCTION public.mark_quote_replies_read(_quote_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _q public.quotes%ROWTYPE;
  _count integer;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_work_quote(_q.workshop_id, _q.contact_id) THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501'; END IF;

  UPDATE public.quote_email_replies SET read_at = now(), read_by = auth.uid()
  WHERE quote_id = _quote_id AND read_at IS NULL;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_quote_replies_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_quote_replies_read(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Files the customer attaches to a reply are stored by the webhook under
-- quotations/<workshop>/replies/…; nobody may add, change or delete them from
-- the app (the existing read policy of the bucket already applies).
DROP POLICY IF EXISTS "quote_reply_files_no_insert" ON storage.objects;
CREATE POLICY "quote_reply_files_no_insert" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (bucket_id = 'quotations' AND name LIKE '%/replies/%'));

DROP POLICY IF EXISTS "quote_reply_files_no_update" ON storage.objects;
CREATE POLICY "quote_reply_files_no_update" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (bucket_id = 'quotations' AND name LIKE '%/replies/%'));

DROP POLICY IF EXISTS "quote_reply_files_no_delete" ON storage.objects;
CREATE POLICY "quote_reply_files_no_delete" ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (bucket_id = 'quotations' AND name LIKE '%/replies/%'));
