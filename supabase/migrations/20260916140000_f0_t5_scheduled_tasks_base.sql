-- F0 · Tarea 5 (1/2) — Base de tareas programadas.
-- Sirve con pg_cron o con un cron externo: ambos llaman a la función
-- scheduled-tasks con el encabezado x-cron-secret.
-- Idempotente: se puede correr más de una vez.

-- 1. health_logs acepta eventos que no pertenecen a un workshop (el latido del
--    cron, y los errores que build-ai-reply, whatsapp-webhook y
--    public-booking-create ya intentaban registrar con workshop_id null y hoy
--    se perdían). Ninguna pantalla los muestra: todas filtran por workshop_id.
ALTER TABLE public.health_logs ALTER COLUMN workshop_id DROP NOT NULL;

-- 2. Secreto compartido, generado dentro de la base. Nunca se escribe en el
--    repo. Una segunda pasada no lo cambia.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'cron_secret',
      'Secreto que exige la función scheduled-tasks en el encabezado x-cron-secret'
    );
  END IF;
END $$;

-- 3. Validación del secreto. Solo la función (service_role) puede llamarla.
CREATE OR REPLACE FUNCTION public.verify_cron_secret(_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    length(_token) >= 32
    AND EXISTS (
      SELECT 1 FROM vault.decrypted_secrets
      WHERE name = 'cron_secret' AND decrypted_secret = _token
    ),
    false
  )
$$;

REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;
