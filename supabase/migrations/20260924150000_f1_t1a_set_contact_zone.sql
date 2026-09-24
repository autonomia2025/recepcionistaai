-- F1 · Tarea 1 (1/2) — Solo agrega. Correr ANTES de publicar el frontend.
--
-- current_staff_zone(): la zona que restringe al usuario actual (NULL = sin
-- restricción). La usan set_contact_zone y, en la migración 2/2, las políticas.
--
-- set_contact_zone(): único camino para cambiar la zona de un contacto desde la
-- pantalla. Con las políticas de zona (2/2), un vendedor ya no podría mover un
-- contacto fuera de su zona con un UPDATE directo, porque la fila nueva deja de
-- serle visible; esta función lo permite con reglas explícitas.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.current_staff_zone()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.zone
  FROM public.profiles p
  JOIN public.workshops w ON w.id = p.workshop_id
  WHERE p.id = auth.uid()
    AND p.role = 'STAFF'
    AND p.zone IS NOT NULL
    AND (w.features ->> 'zones')::boolean IS TRUE
$$;

REVOKE ALL ON FUNCTION public.current_staff_zone() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_staff_zone() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_contact_zone(_contact_id uuid, _zone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _contact_workshop uuid;
  _current_zone text;
  _staff_zone text;
BEGIN
  SELECT c.workshop_id, c.zone INTO _contact_workshop, _current_zone
  FROM public.contacts c
  WHERE c.id = _contact_id;

  IF _contact_workshop IS NULL THEN
    RAISE EXCEPTION 'Contacto no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_superadmin(auth.uid())
    OR public.get_user_workshop_id(auth.uid()) = _contact_workshop
  ) THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;

  -- A zone-restricted seller can only move contacts that are in their zone.
  _staff_zone := public.current_staff_zone();
  IF _staff_zone IS NOT NULL AND _current_zone IS DISTINCT FROM _staff_zone THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;

  IF _zone IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workshop_zones z
    WHERE z.workshop_id = _contact_workshop AND z.key = _zone AND z.is_active
  ) THEN
    RAISE EXCEPTION 'Zona inválida: %', _zone USING ERRCODE = '22023';
  END IF;

  UPDATE public.contacts SET zone = _zone WHERE id = _contact_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_contact_zone(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_contact_zone(uuid, text) TO authenticated;
