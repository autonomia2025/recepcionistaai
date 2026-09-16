-- Zones become data: labels, colours, notification emails and the city aliases
-- used to detect a zone all live here instead of being copied across the code.
CREATE TABLE IF NOT EXISTS public.workshop_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'slate',
  notification_email text,
  aliases text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, key),
  CONSTRAINT workshop_zones_key_format CHECK (key ~ '^[a-z0-9_]{2,40}$')
);

CREATE INDEX IF NOT EXISTS idx_workshop_zones_workshop ON public.workshop_zones(workshop_id, sort_order);

DROP TRIGGER IF EXISTS update_workshop_zones_updated_at ON public.workshop_zones;
CREATE TRIGGER update_workshop_zones_updated_at
  BEFORE UPDATE ON public.workshop_zones
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workshop_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_read_workshop_zones" ON public.workshop_zones;
CREATE POLICY "members_read_workshop_zones"
ON public.workshop_zones FOR SELECT
TO authenticated
USING (workshop_id = public.get_user_workshop_id(auth.uid()) OR public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "admin_manage_workshop_zones" ON public.workshop_zones;
CREATE POLICY "admin_manage_workshop_zones"
ON public.workshop_zones FOR ALL
TO authenticated
USING (
  public.is_superadmin(auth.uid())
  OR (workshop_id = public.get_user_workshop_id(auth.uid()) AND public.has_role(auth.uid(), 'ADMIN'::app_role))
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR (workshop_id = public.get_user_workshop_id(auth.uid()) AND public.has_role(auth.uid(), 'ADMIN'::app_role))
);

-- Backfill for every workshop that already works with zones. Labels, colours and
-- aliases reproduce exactly what the code had hardcoded, and the notification
-- emails come from workshops.zone_notification_emails.
INSERT INTO public.workshop_zones (workshop_id, key, label, color, notification_email, aliases, sort_order)
SELECT
  w.id,
  z.key,
  z.label,
  z.color,
  nullif(w.zone_notification_emails ->> z.key, ''),
  z.aliases,
  z.sort_order
FROM public.workshops w
CROSS JOIN (
  VALUES
    ('talca', 'Talca', 'emerald', ARRAY['talca','maule','curico','linares','san javier','constitucion','cauquenes','molina'], 1),
    ('puerto_montt', 'Puerto Montt', 'violet', ARRAY['puerto montt','pto montt','pto. montt','los lagos','osorno','puerto varas','llanquihue','castro','chiloe','ancud'], 2),
    ('santiago', 'Santiago', 'blue', ARRAY['santiago','stgo','region metropolitana','rm','providencia','las condes','maipu','nunoa','la florida','puente alto','san bernardo','vitacura','la reina','penalolen','quilicura','recoleta','independencia','estacion central','macul','lo barnechea','huechuraba'], 3)
) AS z(key, label, color, aliases, sort_order)
WHERE coalesce((w.features ->> 'zones')::boolean, false)
ON CONFLICT (workshop_id, key) DO NOTHING;
