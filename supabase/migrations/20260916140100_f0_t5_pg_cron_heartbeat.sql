-- F0 · Tarea 5 (2/2) — pg_cron + pg_net llaman a la función scheduled-tasks.
-- Requiere 20260916140000_f0_t5_scheduled_tasks_base.sql.
-- Si el proyecto no ofrece pg_cron o pg_net, esta migración se detiene sin
-- cambiar nada y se usa un cron externo contra el mismo endpoint.
-- Idempotente: se puede correr más de una vez.

DO $$
DECLARE
  _missing text;
BEGIN
  SELECT string_agg(ext, ', ') INTO _missing
  FROM unnest(ARRAY['pg_cron', 'pg_net', 'supabase_vault']) AS ext
  WHERE NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = ext);

  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'Extensiones no disponibles en este proyecto: %. Usar cron externo.', _missing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    RAISE EXCEPTION 'Falta cron_secret: correr antes 20260916140000_f0_t5_scheduled_tasks_base.sql';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- La URL vive como dato para poder cambiarla sin tocar código.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'scheduled_tasks_url') THEN
    PERFORM vault.create_secret(
      'https://hblwddfcfiblesjcosjt.supabase.co/functions/v1/scheduled-tasks',
      'scheduled_tasks_url',
      'Endpoint que invoca pg_cron para las tareas programadas'
    );
  END IF;
END $$;

-- Encola la llamada HTTP (pg_net es asíncrono); devuelve el id de la solicitud,
-- cuya respuesta queda en net._http_response.
CREATE OR REPLACE FUNCTION public.invoke_scheduled_task(_task text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _url text;
  _secret text;
  _request_id bigint;
BEGIN
  SELECT decrypted_secret INTO _url FROM vault.decrypted_secrets WHERE name = 'scheduled_tasks_url';
  SELECT decrypted_secret INTO _secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF _url IS NULL OR _secret IS NULL THEN
    RAISE EXCEPTION 'invoke_scheduled_task: faltan scheduled_tasks_url o cron_secret en Vault';
  END IF;

  SELECT net.http_post(
    url := _url,
    body := jsonb_build_object('task', _task, 'trigger', 'pg_cron'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', _secret),
    timeout_milliseconds := 30000
  ) INTO _request_id;

  RETURN _request_id;
END $$;

REVOKE ALL ON FUNCTION public.invoke_scheduled_task(text) FROM PUBLIC, anon, authenticated;

-- Tarea de prueba: un latido por hora en health_logs. cron.schedule con un
-- nombre existente actualiza el job en vez de duplicarlo.
SELECT cron.schedule(
  'scheduled-tasks-heartbeat',
  '0 * * * *',
  $$SELECT public.invoke_scheduled_task('heartbeat')$$
);
