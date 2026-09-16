-- Commercial module settings. Everything the quote PDF, the alerts and the
-- coaching will read, with working defaults until SOC sends its real data.

CREATE OR REPLACE FUNCTION public.is_valid_rut(_rut text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  clean text;
  body text;
  check_digit text;
  total integer := 0;
  factor integer := 2;
  remainder integer;
  i integer;
BEGIN
  IF _rut IS NULL THEN
    RETURN true;
  END IF;

  clean := upper(regexp_replace(_rut, '[^0-9kK]', '', 'g'));
  IF length(clean) < 2 THEN
    RETURN false;
  END IF;

  body := left(clean, length(clean) - 1);
  check_digit := right(clean, 1);
  IF body !~ '^[0-9]+$' THEN
    RETURN false;
  END IF;

  FOR i IN REVERSE length(body)..1 LOOP
    total := total + substr(body, i, 1)::integer * factor;
    factor := CASE WHEN factor = 7 THEN 2 ELSE factor + 1 END;
  END LOOP;

  remainder := 11 - (total % 11);
  RETURN check_digit = CASE remainder WHEN 11 THEN '0' WHEN 10 THEN 'K' ELSE remainder::text END;
END;
$$;

CREATE TABLE IF NOT EXISTS public.commercial_settings (
  workshop_id uuid PRIMARY KEY REFERENCES public.workshops(id) ON DELETE CASCADE,

  legal_name text,
  tax_id text CONSTRAINT commercial_settings_tax_id_valid CHECK (public.is_valid_rut(tax_id)),
  address text,
  phones text[] NOT NULL DEFAULT '{}',
  email text,
  logo_path text,
  primary_color text NOT NULL DEFAULT '#1A9387'
    CONSTRAINT commercial_settings_primary_color_hex CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text NOT NULL DEFAULT '#127BA1'
    CONSTRAINT commercial_settings_secondary_color_hex CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),

  quote_prefix text NOT NULL DEFAULT 'COT'
    CONSTRAINT commercial_settings_quote_prefix_format CHECK (quote_prefix ~ '^[A-Z0-9]{1,10}$'),
  next_quote_number integer NOT NULL DEFAULT 1
    CONSTRAINT commercial_settings_next_quote_number_positive CHECK (next_quote_number >= 1),
  quote_number_padding smallint NOT NULL DEFAULT 4
    CONSTRAINT commercial_settings_quote_number_padding_range CHECK (quote_number_padding BETWEEN 1 AND 8),
  quote_number_includes_year boolean NOT NULL DEFAULT true,

  quote_validity_days smallint NOT NULL DEFAULT 15
    CONSTRAINT commercial_settings_validity_range CHECK (quote_validity_days BETWEEN 1 AND 365),
  default_payment_terms text NOT NULL DEFAULT 'A convenir con el ejecutivo',
  default_delivery_terms text NOT NULL DEFAULT 'Según disponibilidad, confirma el vendedor',
  legal_footer text NOT NULL DEFAULT 'Precios en pesos chilenos, netos, sin IVA salvo indicación contraria. Cotización válida por el plazo indicado y sujeta a disponibilidad de stock al momento de confirmar la compra. Las especificaciones técnicas pueden variar según el fabricante.',
  vat_rate numeric(5, 2) NOT NULL DEFAULT 19
    CONSTRAINT commercial_settings_vat_range CHECK (vat_rate BETWEEN 0 AND 100),

  timezone text NOT NULL DEFAULT 'America/Santiago',
  business_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'
    CONSTRAINT commercial_settings_business_days_valid CHECK (business_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  business_opens_at time NOT NULL DEFAULT '09:00',
  business_closes_at time NOT NULL DEFAULT '18:00',
  unquoted_lead_alert_hours smallint NOT NULL DEFAULT 48
    CONSTRAINT commercial_settings_alert_hours_positive CHECK (unquoted_lead_alert_hours > 0),
  discount_approval_threshold numeric(5, 2) NOT NULL DEFAULT 15
    CONSTRAINT commercial_settings_discount_threshold_range CHECK (discount_approval_threshold BETWEEN 0 AND 100),

  lost_reasons text[] NOT NULL DEFAULT ARRAY['Precio', 'Competencia', 'Sin presupuesto', 'Fuera de plazo', 'No responde', 'Otro'],

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT commercial_settings_business_hours_order CHECK (business_closes_at > business_opens_at)
);

COMMENT ON TABLE public.commercial_settings IS
  'Una fila por workshop con el módulo comercial. Se crea solo vía ensure_commercial_settings; la edita el ADMIN desde Configuración comercial.';
COMMENT ON COLUMN public.commercial_settings.next_quote_number IS
  'Siguiente correlativo de cotización. Hoy lo fija el ADMIN; el envío de cotizaciones lo incrementará con una función atómica.';

DROP TRIGGER IF EXISTS update_commercial_settings_updated_at ON public.commercial_settings;
CREATE TRIGGER update_commercial_settings_updated_at
  BEFORE UPDATE ON public.commercial_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.commercial_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_read_commercial_settings" ON public.commercial_settings;
CREATE POLICY "members_read_commercial_settings"
ON public.commercial_settings FOR SELECT
TO authenticated
USING (workshop_id = public.get_user_workshop_id(auth.uid()) OR public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "admin_update_commercial_settings" ON public.commercial_settings;
CREATE POLICY "admin_update_commercial_settings"
ON public.commercial_settings FOR UPDATE
TO authenticated
USING (
  public.is_superadmin(auth.uid())
  OR (workshop_id = public.get_user_workshop_id(auth.uid()) AND public.has_role(auth.uid(), 'ADMIN'::app_role))
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR (workshop_id = public.get_user_workshop_id(auth.uid()) AND public.has_role(auth.uid(), 'ADMIN'::app_role))
);

-- The only way a settings row is created: defaults, identity seeded from the workshop.
CREATE OR REPLACE FUNCTION public.ensure_commercial_settings(_workshop_id uuid)
RETURNS public.commercial_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings public.commercial_settings;
BEGIN
  IF NOT (
    public.is_superadmin(auth.uid())
    OR public.get_user_workshop_id(auth.uid()) = _workshop_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_feature(_workshop_id, 'commercial') THEN
    RAISE EXCEPTION 'El módulo comercial no está activo para este negocio' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.commercial_settings (workshop_id, legal_name, address, phones, email)
  SELECT
    w.id,
    w.name,
    nullif(concat_ws(', ', nullif(w.address, ''), nullif(w.city, '')), ''),
    CASE WHEN nullif(w.phone, '') IS NULL THEN '{}'::text[] ELSE ARRAY[w.phone] END,
    coalesce(nullif(w.admin_notification_email, ''), nullif(w.gmail_email, ''))
  FROM public.workshops w
  WHERE w.id = _workshop_id
  ON CONFLICT (workshop_id) DO NOTHING;

  SELECT * INTO settings FROM public.commercial_settings WHERE workshop_id = _workshop_id;
  RETURN settings;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_commercial_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_commercial_settings(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.sales_playbook_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  title text NOT NULL CONSTRAINT sales_playbook_docs_title_present CHECK (length(trim(title)) > 0),
  category text NOT NULL DEFAULT 'general'
    CONSTRAINT sales_playbook_docs_category_valid CHECK (category IN ('general', 'producto', 'objeciones', 'competencia', 'precios', 'servicio')),
  content text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_playbook_docs_workshop ON public.sales_playbook_docs(workshop_id);

DROP TRIGGER IF EXISTS update_sales_playbook_docs_updated_at ON public.sales_playbook_docs;
CREATE TRIGGER update_sales_playbook_docs_updated_at
  BEFORE UPDATE ON public.sales_playbook_docs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sales_playbook_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_read_sales_playbook_docs" ON public.sales_playbook_docs;
CREATE POLICY "members_read_sales_playbook_docs"
ON public.sales_playbook_docs FOR SELECT
TO authenticated
USING (workshop_id = public.get_user_workshop_id(auth.uid()) OR public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "admin_manage_sales_playbook_docs" ON public.sales_playbook_docs;
CREATE POLICY "admin_manage_sales_playbook_docs"
ON public.sales_playbook_docs FOR ALL
TO authenticated
USING (
  public.is_superadmin(auth.uid())
  OR (workshop_id = public.get_user_workshop_id(auth.uid()) AND public.has_role(auth.uid(), 'ADMIN'::app_role))
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR (workshop_id = public.get_user_workshop_id(auth.uid()) AND public.has_role(auth.uid(), 'ADMIN'::app_role))
);

-- Logos for the quote PDF. PNG and JPEG only: the PDF renderer cannot embed SVG.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('commercial-assets', 'commercial-assets', false, 2097152, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "commercial_assets_read" ON storage.objects;
CREATE POLICY "commercial_assets_read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'commercial-assets'
  AND (
    (storage.foldername(name))[1] = public.get_user_workshop_id(auth.uid())::text
    OR public.is_superadmin(auth.uid())
  )
);

DROP POLICY IF EXISTS "commercial_assets_admin_insert" ON storage.objects;
CREATE POLICY "commercial_assets_admin_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'commercial-assets'
  AND (
    public.is_superadmin(auth.uid())
    OR (
      (storage.foldername(name))[1] = public.get_user_workshop_id(auth.uid())::text
      AND public.has_role(auth.uid(), 'ADMIN'::app_role)
    )
  )
);

DROP POLICY IF EXISTS "commercial_assets_admin_update" ON storage.objects;
CREATE POLICY "commercial_assets_admin_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'commercial-assets'
  AND (
    public.is_superadmin(auth.uid())
    OR (
      (storage.foldername(name))[1] = public.get_user_workshop_id(auth.uid())::text
      AND public.has_role(auth.uid(), 'ADMIN'::app_role)
    )
  )
);

DROP POLICY IF EXISTS "commercial_assets_admin_delete" ON storage.objects;
CREATE POLICY "commercial_assets_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'commercial-assets'
  AND (
    public.is_superadmin(auth.uid())
    OR (
      (storage.foldername(name))[1] = public.get_user_workshop_id(auth.uid())::text
      AND public.has_role(auth.uid(), 'ADMIN'::app_role)
    )
  )
);

-- The commercial module is SOC-only; enabling the flag surfaces its settings screen.
UPDATE public.workshops
SET features = features || '{"commercial": true}'::jsonb
WHERE id = '610fb257-a649-4115-b944-21f31e7952db'::uuid
  AND coalesce((features ->> 'commercial')::boolean, false) = false;

INSERT INTO public.commercial_settings (workshop_id, legal_name, address, phones, email)
SELECT
  w.id,
  w.name,
  nullif(concat_ws(', ', nullif(w.address, ''), nullif(w.city, '')), ''),
  CASE WHEN nullif(w.phone, '') IS NULL THEN '{}'::text[] ELSE ARRAY[w.phone] END,
  coalesce(nullif(w.admin_notification_email, ''), nullif(w.gmail_email, ''))
FROM public.workshops w
WHERE coalesce((w.features ->> 'commercial')::boolean, false)
ON CONFLICT (workshop_id) DO NOTHING;
