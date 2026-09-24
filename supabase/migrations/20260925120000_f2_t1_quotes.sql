-- F2 · Tarea 1 — Modelo de cotización (solo agrega).
--
-- quotes + quote_lines. Reglas que viven en la base:
--   · Totales calculados siempre por la base (pesos enteros):
--       línea   = round(cantidad × precio) con su descuento
--       neto    = suma de líneas − descuento global
--       IVA     = round(neto × tasa);  total = neto + IVA
--     Nadie puede escribir un total: las columnas de totales no tienen permiso
--     de escritura para usuarios.
--   · El número (COT-2026-0001) se asigna solo al emitir, con issue_quote(),
--     tomando commercial_settings.next_quote_number de forma atómica.
--   · Una cotización emitida es inmutable: solo se edita un borrador; para
--     cambiar una emitida se crea una revisión (revision_of).
--   · discount_over_threshold se marca solo si algún descuento supera el umbral
--     de Configuración comercial (aviso, no bloqueo).
--   · Solo workshops con el módulo comercial; un vendedor con zona solo trabaja
--     cotizaciones de contactos de su zona.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  service_request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  revision_of uuid REFERENCES public.quotes(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT quotes_status_valid CHECK (status IN ('draft', 'issued', 'sent', 'accepted', 'rejected', 'void')),
  quote_number text,

  client_name text NOT NULL,
  client_company text,
  client_tax_id text CONSTRAINT quotes_client_tax_id_valid CHECK (public.is_valid_rut(client_tax_id)),
  client_email text,
  client_phone text,
  client_address text,

  vat_rate numeric(5, 2) NOT NULL CONSTRAINT quotes_vat_range CHECK (vat_rate BETWEEN 0 AND 100),
  validity_days smallint NOT NULL CONSTRAINT quotes_validity_range CHECK (validity_days BETWEEN 1 AND 365),
  payment_terms text NOT NULL,
  delivery_terms text NOT NULL,
  legal_footer text NOT NULL,
  notes text,
  global_discount_pct numeric(5, 2) NOT NULL DEFAULT 0
    CONSTRAINT quotes_global_discount_range CHECK (global_discount_pct BETWEEN 0 AND 100),

  gross_subtotal numeric(14, 0) NOT NULL DEFAULT 0,
  discount_total numeric(14, 0) NOT NULL DEFAULT 0,
  net_total numeric(14, 0) NOT NULL DEFAULT 0,
  vat_total numeric(14, 0) NOT NULL DEFAULT 0,
  total numeric(14, 0) NOT NULL DEFAULT 0,
  max_discount_pct numeric(5, 2) NOT NULL DEFAULT 0,
  discount_over_threshold boolean NOT NULL DEFAULT false,

  pdf_path text,
  issued_at timestamptz,
  issued_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sent_at timestamptz,
  sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at timestamptz,
  lost_reason text,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quotes_number_unique UNIQUE (workshop_id, quote_number),
  CONSTRAINT quotes_number_when_issued CHECK ((status = 'draft') = (quote_number IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_quotes_request ON public.quotes (service_request_id);
CREATE INDEX IF NOT EXISTS idx_quotes_contact ON public.quotes (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_workshop ON public.quotes (workshop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  sku text,
  sku_normalized text,
  description text NOT NULL CONSTRAINT quote_lines_description_present CHECK (length(btrim(description)) > 0),
  quantity numeric(12, 2) NOT NULL DEFAULT 1 CONSTRAINT quote_lines_quantity_positive CHECK (quantity > 0),
  unit_price numeric(14, 0) NOT NULL DEFAULT 0 CONSTRAINT quote_lines_unit_price_positive CHECK (unit_price >= 0),
  discount_pct numeric(5, 2) NOT NULL DEFAULT 0 CONSTRAINT quote_lines_discount_range CHECK (discount_pct BETWEEN 0 AND 100),
  price_min numeric(14, 0),
  price_max numeric(14, 0),
  source text NOT NULL DEFAULT 'manual'
    CONSTRAINT quote_lines_source_valid CHECK (source IN ('chosen', 'customer_asked', 'datasheet_sent', 'suggested', 'manual')),
  gross_amount numeric(14, 0) GENERATED ALWAYS AS (round(quantity * unit_price)) STORED,
  line_total numeric(14, 0) GENERATED ALWAYS AS (round(round(quantity * unit_price) * (1 - discount_pct / 100))) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON public.quote_lines (quote_id, position);

-- ---------------------------------------------------------------------------
-- Access scope: member of the workshop with the commercial module, and a
-- zone-restricted seller only for contacts of their zone.
CREATE OR REPLACE FUNCTION public.can_work_quote(_workshop_id uuid, _contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    public.is_superadmin(auth.uid())
    OR (
      public.get_user_workshop_id(auth.uid()) = _workshop_id
      AND EXISTS (SELECT 1 FROM public.workshops w WHERE w.id = _workshop_id AND (w.features ->> 'commercial')::boolean IS TRUE)
      AND (
        public.current_staff_zone() IS NULL
        OR EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = _contact_id AND c.zone = public.current_staff_zone())
      )
    )
$$;

REVOKE ALL ON FUNCTION public.can_work_quote(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_work_quote(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Totals (always recomputed from the lines).
CREATE OR REPLACE FUNCTION public.quotes_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _s public.commercial_settings%ROWTYPE;
  _gross numeric := 0;
  _after_lines numeric := 0;
  _max_line_pct numeric := 0;
  _global numeric;
  _net numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND (
    NEW.client_name, NEW.client_company, NEW.client_tax_id, NEW.client_email, NEW.client_phone, NEW.client_address,
    NEW.vat_rate, NEW.validity_days, NEW.payment_terms, NEW.delivery_terms, NEW.legal_footer, NEW.notes,
    NEW.global_discount_pct, NEW.contact_id, NEW.workshop_id
  ) IS DISTINCT FROM (
    OLD.client_name, OLD.client_company, OLD.client_tax_id, OLD.client_email, OLD.client_phone, OLD.client_address,
    OLD.vat_rate, OLD.validity_days, OLD.payment_terms, OLD.delivery_terms, OLD.legal_footer, OLD.notes,
    OLD.global_discount_pct, OLD.contact_id, OLD.workshop_id
  ) THEN
    RAISE EXCEPTION 'La cotización % ya fue emitida y no se puede modificar; crea una revisión', OLD.quote_number
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO _s FROM public.commercial_settings WHERE workshop_id = NEW.workshop_id;

  IF TG_OP = 'INSERT' THEN
    NEW.vat_rate := coalesce(NEW.vat_rate, _s.vat_rate, 19);
    NEW.validity_days := coalesce(NEW.validity_days, _s.quote_validity_days, 15);
    NEW.payment_terms := coalesce(NEW.payment_terms, _s.default_payment_terms, 'A convenir con el ejecutivo');
    NEW.delivery_terms := coalesce(NEW.delivery_terms, _s.default_delivery_terms, 'Según disponibilidad');
    NEW.legal_footer := coalesce(NEW.legal_footer, _s.legal_footer, '');
    IF NEW.client_name IS NULL THEN
      SELECT c.name INTO NEW.client_name FROM public.contacts c WHERE c.id = NEW.contact_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.workshop_id = NEW.workshop_id) THEN
      RAISE EXCEPTION 'El contacto no pertenece a este taller' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.gross_subtotal := 0;
  ELSE
    SELECT coalesce(sum(l.gross_amount), 0), coalesce(sum(l.line_total), 0), coalesce(max(l.discount_pct), 0)
      INTO _gross, _after_lines, _max_line_pct
    FROM public.quote_lines l WHERE l.quote_id = NEW.id;
  END IF;

  _global := round(_after_lines * NEW.global_discount_pct / 100);
  _net := _after_lines - _global;
  NEW.gross_subtotal := _gross;
  NEW.net_total := _net;
  NEW.discount_total := _gross - _net;
  NEW.vat_total := round(_net * NEW.vat_rate / 100);
  NEW.total := _net + NEW.vat_total;
  NEW.max_discount_pct := greatest(
    _max_line_pct,
    NEW.global_discount_pct,
    CASE WHEN _gross > 0 THEN round((_gross - _net) * 100 / _gross, 2) ELSE 0 END
  );
  NEW.discount_over_threshold := NEW.max_discount_pct > coalesce(_s.discount_approval_threshold, 100);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_before_write ON public.quotes;
CREATE TRIGGER quotes_before_write
  BEFORE INSERT OR UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quotes_before_write();

CREATE OR REPLACE FUNCTION public.quotes_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Cascades (deleting a contact or a workshop) are allowed; a direct delete of
  -- an issued quote is not.
  IF OLD.status <> 'draft' AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'La cotización % ya fue emitida y no se puede borrar; anúlala', OLD.quote_number
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS quotes_before_delete ON public.quotes;
CREATE TRIGGER quotes_before_delete
  BEFORE DELETE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quotes_before_delete();

-- Lines: only on drafts; workshop copied from the quote; totals refreshed.
CREATE OR REPLACE FUNCTION public.quote_lines_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _quote_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.quote_id ELSE NEW.quote_id END;
  _status text;
  _workshop uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.quote_id <> OLD.quote_id THEN
    RAISE EXCEPTION 'Una línea no se puede mover a otra cotización' USING ERRCODE = '55000';
  END IF;

  SELECT q.status, q.workshop_id INTO _status, _workshop FROM public.quotes q WHERE q.id = _quote_id;
  IF _status IS NOT NULL AND _status <> 'draft' AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'La cotización ya fue emitida: sus líneas no se pueden modificar' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.workshop_id := _workshop;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quote_lines_before_write ON public.quote_lines;
CREATE TRIGGER quote_lines_before_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.quote_lines
  FOR EACH ROW EXECUTE FUNCTION public.quote_lines_before_write();

CREATE OR REPLACE FUNCTION public.quote_lines_after_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Touching the quote re-runs quotes_before_write, which recomputes totals.
  UPDATE public.quotes SET updated_at = now()
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.quote_id ELSE NEW.quote_id END
    AND status = 'draft';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS quote_lines_after_write ON public.quote_lines;
CREATE TRIGGER quote_lines_after_write
  AFTER INSERT OR UPDATE OR DELETE ON public.quote_lines
  FOR EACH ROW EXECUTE FUNCTION public.quote_lines_after_write();

-- ---------------------------------------------------------------------------
-- Issue: assigns the official number atomically and freezes the quote.
CREATE OR REPLACE FUNCTION public.issue_quote(_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _q public.quotes%ROWTYPE;
  _s public.commercial_settings%ROWTYPE;
  _n integer;
  _number text;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_work_quote(_q.workshop_id, _q.contact_id) THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;
  IF _q.status <> 'draft' THEN
    RAISE EXCEPTION 'La cotización ya fue emitida (%)', _q.quote_number USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quote_lines l WHERE l.quote_id = _quote_id) THEN
    RAISE EXCEPTION 'La cotización no tiene líneas' USING ERRCODE = '22023';
  END IF;
  IF _q.net_total <= 0 THEN
    RAISE EXCEPTION 'El total de la cotización debe ser mayor a cero' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _s FROM public.commercial_settings WHERE workshop_id = _q.workshop_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Falta la Configuración comercial del taller' USING ERRCODE = 'P0002';
  END IF;

  _n := _s.next_quote_number;
  LOOP
    _number := concat_ws('-',
      _s.quote_prefix,
      CASE WHEN _s.quote_number_includes_year
        THEN extract(year FROM now() AT TIME ZONE _s.timezone)::int::text END,
      lpad(_n::text, _s.quote_number_padding, '0'));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.quotes WHERE workshop_id = _q.workshop_id AND quote_number = _number);
    _n := _n + 1;   -- the counter was set back by hand: skip numbers already used
  END LOOP;

  UPDATE public.commercial_settings SET next_quote_number = _n + 1 WHERE workshop_id = _q.workshop_id;
  UPDATE public.quotes
    SET status = 'issued', quote_number = _number, issued_at = now(), issued_by = auth.uid()
  WHERE id = _quote_id;

  RETURN jsonb_build_object('quote_id', _quote_id, 'quote_number', _number);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_quote(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Privileges: users write only editable columns; status, number and totals
-- change only through the functions above.
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_lines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.quotes, public.quote_lines FROM anon, authenticated;
GRANT SELECT, DELETE ON public.quotes TO authenticated;
GRANT INSERT (workshop_id, service_request_id, contact_id, conversation_id, revision_of,
  client_name, client_company, client_tax_id, client_email, client_phone, client_address,
  vat_rate, validity_days, payment_terms, delivery_terms, legal_footer, notes, global_discount_pct)
  ON public.quotes TO authenticated;
GRANT UPDATE (client_name, client_company, client_tax_id, client_email, client_phone, client_address,
  vat_rate, validity_days, payment_terms, delivery_terms, legal_footer, notes, global_discount_pct)
  ON public.quotes TO authenticated;

GRANT SELECT, DELETE ON public.quote_lines TO authenticated;
GRANT INSERT (quote_id, position, sku, sku_normalized, description, quantity, unit_price, discount_pct, price_min, price_max, source)
  ON public.quote_lines TO authenticated;
GRANT UPDATE (position, description, quantity, unit_price, discount_pct)
  ON public.quote_lines TO authenticated;
GRANT ALL ON public.quotes, public.quote_lines TO service_role;

DROP POLICY IF EXISTS "quotes_scope" ON public.quotes;
CREATE POLICY "quotes_scope" ON public.quotes
  FOR ALL TO authenticated
  USING (public.can_work_quote(workshop_id, contact_id))
  WITH CHECK (public.can_work_quote(workshop_id, contact_id));

DROP POLICY IF EXISTS "quote_lines_scope" ON public.quote_lines;
CREATE POLICY "quote_lines_scope" ON public.quote_lines
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_lines.quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_lines.quote_id));
