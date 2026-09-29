-- F4 · T1: each seller connects their own Outlook / Microsoft 365 mailbox.
-- The panel sends quotes from that mailbox and brings back only the emails
-- exchanged with the business's contacts (never the rest of the inbox).
-- Commercial module only. Additive: new tables, functions, storage policies
-- for a new folder and one cron job.

-- An earlier draft of this phase (sending through Resend) was replaced before
-- use. If its migration was run, drop its empty objects.
DROP TABLE IF EXISTS public.quote_email_replies CASCADE;
DROP TABLE IF EXISTS public.quote_emails CASCADE;
DROP TABLE IF EXISTS public.workshop_email_domains CASCADE;
DROP FUNCTION IF EXISTS public.mark_quote_replies_read(uuid);
DROP POLICY IF EXISTS "quote_reply_files_no_insert" ON storage.objects;
DROP POLICY IF EXISTS "quote_reply_files_no_update" ON storage.objects;
DROP POLICY IF EXISTS "quote_reply_files_no_delete" ON storage.objects;

-- ---------------------------------------------------------------------------
-- One connected mailbox per person. Tokens are only readable by the service
-- role (edge functions); people see whether they are connected.
CREATE TABLE IF NOT EXISTS public.staff_mailboxes (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'microsoft'
    CONSTRAINT staff_mailboxes_provider_valid CHECK (provider IN ('microsoft')),
  email text NOT NULL,
  display_name text,
  access_token text,
  refresh_token text NOT NULL,
  token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT staff_mailboxes_status_valid CHECK (status IN ('active', 'error')),
  last_error text,
  inbox_synced_until timestamptz,
  sent_synced_until timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_mailboxes_workshop ON public.staff_mailboxes (workshop_id);

DROP TRIGGER IF EXISTS update_staff_mailboxes_updated_at ON public.staff_mailboxes;
CREATE TRIGGER update_staff_mailboxes_updated_at
  BEFORE UPDATE ON public.staff_mailboxes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.staff_mailboxes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_mailboxes FROM anon, authenticated;
GRANT SELECT (user_id, workshop_id, provider, email, display_name, status, last_error, connected_at, last_sync_at)
  ON public.staff_mailboxes TO authenticated;
GRANT ALL ON public.staff_mailboxes TO service_role;

-- Your own connection; admins see who in their business is connected.
DROP POLICY IF EXISTS "staff_mailboxes_read" ON public.staff_mailboxes;
CREATE POLICY "staff_mailboxes_read" ON public.staff_mailboxes
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_superadmin(auth.uid())
    OR (workshop_id = public.get_user_workshop_id(auth.uid()) AND public.has_role(auth.uid(), 'ADMIN'::app_role))
  );

CREATE OR REPLACE FUNCTION public.disconnect_my_mailbox()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH gone AS (DELETE FROM public.staff_mailboxes WHERE user_id = auth.uid() RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM gone);
$$;

REVOKE ALL ON FUNCTION public.disconnect_my_mailbox() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disconnect_my_mailbox() TO authenticated;

-- ---------------------------------------------------------------------------
-- Emails with the business's contacts, copied from the sellers' mailboxes
-- (and the ones sent from the panel). Written only by edge functions.
CREATE TABLE IF NOT EXISTS public.contact_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  mailbox_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  mailbox_email text NOT NULL,
  service_request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  provider_message_id text NOT NULL,
  internet_message_id text,
  conversation_id text,
  direction text NOT NULL
    CONSTRAINT contact_emails_direction_valid CHECK (direction IN ('in', 'out')),
  from_address text NOT NULL,
  from_name text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject text,
  body_text text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_at timestamptz NOT NULL,
  sent_from_panel boolean NOT NULL DEFAULT false,
  kind text
    CONSTRAINT contact_emails_kind_valid CHECK (kind IS NULL OR kind IN ('quote', 'answer')),
  read_at timestamptz,
  read_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_emails_unique_message UNIQUE (workshop_id, mailbox_email, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_emails_contact ON public.contact_emails (contact_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_contact_emails_quote ON public.contact_emails (quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_emails_conversation ON public.contact_emails (workshop_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_contact_emails_unread ON public.contact_emails (workshop_id, sent_at DESC)
  WHERE direction = 'in' AND read_at IS NULL;

ALTER TABLE public.contact_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_emails FROM anon, authenticated;
GRANT SELECT ON public.contact_emails TO authenticated;
GRANT ALL ON public.contact_emails TO service_role;

-- Visible exactly where the contact's quotes are visible (seller / zone rules).
DROP POLICY IF EXISTS "contact_emails_read" ON public.contact_emails;
CREATE POLICY "contact_emails_read" ON public.contact_emails
  FOR SELECT TO authenticated
  USING (public.can_work_quote(workshop_id, contact_id));

-- Marks the contact's incoming emails as read by the caller.
CREATE OR REPLACE FUNCTION public.mark_contact_emails_read(_contact_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _workshop uuid;
  _count integer;
BEGIN
  SELECT workshop_id INTO _workshop FROM public.contacts WHERE id = _contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contacto no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_work_quote(_workshop, _contact_id) THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501'; END IF;

  UPDATE public.contact_emails SET read_at = now(), read_by = auth.uid()
  WHERE contact_id = _contact_id AND direction = 'in' AND read_at IS NULL;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_contact_emails_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_contact_emails_read(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Files attached to those emails live in quotations/<workshop>/mail/…; the
-- app may read them (existing bucket policy) but never add, change or delete.
DROP POLICY IF EXISTS "mail_files_no_insert" ON storage.objects;
CREATE POLICY "mail_files_no_insert" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (bucket_id = 'quotations' AND name LIKE '%/mail/%'));

DROP POLICY IF EXISTS "mail_files_no_update" ON storage.objects;
CREATE POLICY "mail_files_no_update" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (bucket_id = 'quotations' AND name LIKE '%/mail/%'));

DROP POLICY IF EXISTS "mail_files_no_delete" ON storage.objects;
CREATE POLICY "mail_files_no_delete" ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (bucket_id = 'quotations' AND name LIKE '%/mail/%'));

-- ---------------------------------------------------------------------------
-- Every 5 minutes, bring new emails from the connected mailboxes
-- (scheduled-tasks → task "mail-sync"). Skipped where pg_cron is not set up.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'invoke_scheduled_task') THEN
    PERFORM cron.schedule('mail-sync', '*/5 * * * *', $job$SELECT public.invoke_scheduled_task('mail-sync')$job$);
  ELSE
    RAISE NOTICE 'pg_cron no está disponible: la sincronización de correos queda solo manual';
  END IF;
END
$cron$;
