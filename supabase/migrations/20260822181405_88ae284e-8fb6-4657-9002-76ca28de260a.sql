CREATE TABLE public.product_catalog (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  sku text NOT NULL,
  sku_normalized text NOT NULL,
  water_type text,
  motor_type text,
  pressure_bar text,
  flow_lmin text,
  temp_max text,
  price_min bigint,
  price_max bigint,
  datasheet_number integer,
  datasheet_file text,
  source_file text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, sku_normalized)
);

CREATE INDEX idx_product_catalog_workshop ON public.product_catalog (workshop_id);
CREATE INDEX idx_product_catalog_block ON public.product_catalog (workshop_id, water_type, motor_type);

GRANT SELECT ON public.product_catalog TO authenticated;
GRANT ALL ON public.product_catalog TO service_role;

ALTER TABLE public.product_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workshop members can view their catalog"
ON public.product_catalog FOR SELECT TO authenticated
USING (workshop_id = public.get_user_workshop_id(auth.uid()) OR public.is_superadmin(auth.uid()));

CREATE POLICY "Superadmins manage catalog"
ON public.product_catalog FOR ALL TO authenticated
USING (public.is_superadmin(auth.uid()))
WITH CHECK (public.is_superadmin(auth.uid()));

CREATE TRIGGER update_product_catalog_updated_at
BEFORE UPDATE ON public.product_catalog
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();