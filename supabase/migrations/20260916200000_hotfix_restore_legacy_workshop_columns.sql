-- HOTFIX (temporal). Las edge functions de producción siguen en su versión
-- anterior a d04cf25, porque el push a main no las desplegó. Esas versiones leen
-- dos columnas que ya se eliminaron:
--   · build-ai-reply lee zone_detection_enabled → falla la consulta del workshop
--     y el bot deja de responder en todos los canales.
--   · send-internal-notification lee zone_notification_emails.
-- Se restauran solo para esas versiones viejas (usan service role, así que no
-- necesitan permisos por columna ni aparecen en workshops_safe). Se vuelven a
-- eliminar cuando las funciones nuevas estén desplegadas y verificadas.
-- Solo agrega: no cambia nada que lea el frontend ni las funciones nuevas.
-- Idempotente.

ALTER TABLE public.workshops ADD COLUMN IF NOT EXISTS zone_detection_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.workshops ADD COLUMN IF NOT EXISTS zone_notification_emails jsonb;

-- Los valores salen de la fuente actual, sin inventar nada.
UPDATE public.workshops
SET zone_detection_enabled = coalesce((features ->> 'zones')::boolean, false);

UPDATE public.workshops w
SET zone_notification_emails = (
  SELECT jsonb_object_agg(z.key, z.notification_email)
  FROM public.workshop_zones z
  WHERE z.workshop_id = w.id
    AND z.is_active
    AND nullif(z.notification_email, '') IS NOT NULL
);
