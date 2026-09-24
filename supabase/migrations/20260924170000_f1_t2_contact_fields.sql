-- F1 · Tarea 2 — Datos del contacto con prioridad por origen.
-- Solo agrega: columnas nuevas y una función. Se puede correr antes de publicar.
--
-- · company_name y tax_id (RUT validado) para la cotización.
-- · field_sources guarda quién escribió cada dato: human > customer > channel.
--     human    = lo escribió una persona del equipo en el panel
--     customer = lo declaró el cliente en la conversación (lo extrae la IA)
--     channel  = viene del canal (nombre del perfil de WhatsApp, etc.)
--   Un dato solo se reemplaza con otro de igual o mayor prioridad, así la IA
--   nunca pisa lo que corrigió un vendedor. Un valor que ya existía sin origen
--   registrado cuenta como "channel".
-- · set_contact_fields() es el punto único para escribir estos datos.
-- Idempotente.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS field_sources jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_tax_id_valid') THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_tax_id_valid CHECK (public.is_valid_rut(tax_id));
  END IF;
END $$;

-- RUT en el mismo formato que usa la pantalla (formatRut): 76.644.520-9
CREATE OR REPLACE FUNCTION public.format_rut(_rut text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN clean IS NULL OR length(clean) < 2 THEN nullif(clean, '')
    ELSE regexp_replace(left(clean, -1), '(\d)(?=(\d{3})+$)', '\1.', 'g') || '-' || right(clean, 1)
  END
  FROM (SELECT upper(regexp_replace(_rut, '[^0-9kK]', '', 'g')) AS clean) s
$$;

CREATE OR REPLACE FUNCTION public.set_contact_fields(_contact_id uuid, _fields jsonb, _source text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _allowed constant text[] := ARRAY['name', 'phone', 'email', 'company_name', 'tax_id'];
  _is_service boolean := coalesce(auth.role(), '') = 'service_role';
  _new_rank int;
  _cur_rank int;
  _c public.contacts%ROWTYPE;
  _current jsonb;
  _sources jsonb;
  _key text;
  _raw jsonb;
  _val text;
  _problem text;
  _applied text[] := '{}';
  _skipped jsonb := '{}';
BEGIN
  _new_rank := CASE _source WHEN 'human' THEN 3 WHEN 'customer' THEN 2 WHEN 'channel' THEN 1 END;
  IF _new_rank IS NULL THEN
    RAISE EXCEPTION 'Origen inválido: %', _source USING ERRCODE = '22023';
  END IF;
  IF _fields IS NULL OR jsonb_typeof(_fields) <> 'object' THEN
    RAISE EXCEPTION 'Los datos deben ser un objeto JSON' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _c FROM public.contacts WHERE id = _contact_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contacto no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- People write only as "human", in their workshop and (sellers) in their zone.
  -- Backend functions (service role) write as customer or channel.
  IF NOT _is_service THEN
    IF _source <> 'human' THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_superadmin(auth.uid()) OR public.get_user_workshop_id(auth.uid()) = _c.workshop_id) THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    IF public.current_staff_zone() IS NOT NULL AND _c.zone IS DISTINCT FROM public.current_staff_zone() THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
  END IF;

  _current := to_jsonb(_c);
  _sources := coalesce(_c.field_sources, '{}'::jsonb);

  FOR _key, _raw IN SELECT key, value FROM jsonb_each(_fields) LOOP
    _problem := NULL;
    _val := CASE WHEN jsonb_typeof(_raw) = 'null' THEN NULL ELSE nullif(btrim(_raw #>> '{}'), '') END;

    IF NOT (_key = ANY (_allowed)) THEN
      _problem := 'campo no permitido';
    ELSIF _val IS NULL AND _key = 'name' THEN
      _problem := 'el nombre no puede quedar vacío';
    ELSIF _val IS NULL AND _new_rank < 3 THEN
      _problem := 'vacío';                       -- only a person can clear a field
    ELSIF _key = 'email' AND _val IS NOT NULL THEN
      _val := lower(_val);
      IF _val !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN _problem := 'correo inválido'; END IF;
    ELSIF _key = 'tax_id' AND _val IS NOT NULL THEN
      IF NOT public.is_valid_rut(_val) THEN _problem := 'RUT inválido'; ELSE _val := public.format_rut(_val); END IF;
    END IF;

    IF _problem IS NULL THEN
      _cur_rank := CASE _sources ->> _key
        WHEN 'human' THEN 3 WHEN 'customer' THEN 2 WHEN 'channel' THEN 1
        ELSE CASE WHEN _current ->> _key IS NULL THEN 0 ELSE 1 END
      END;
      IF _new_rank < _cur_rank THEN
        _problem := format('protegido: lo escribió %s', _sources ->> _key);
      END IF;
    END IF;

    -- A person gets an error; automatic writers just skip the field.
    IF _problem IS NOT NULL THEN
      IF _new_rank = 3 AND _problem NOT LIKE 'protegido%' THEN
        RAISE EXCEPTION '%: %', _key, _problem USING ERRCODE = '22023';
      END IF;
      _skipped := _skipped || jsonb_build_object(_key, _problem);
      CONTINUE;
    END IF;

    EXECUTE format('UPDATE public.contacts SET %I = $1 WHERE id = $2', _key) USING _val, _contact_id;
    _sources := jsonb_set(_sources, ARRAY[_key], to_jsonb(_source));
    _applied := _applied || _key;
  END LOOP;

  IF array_length(_applied, 1) > 0 THEN
    UPDATE public.contacts SET field_sources = _sources WHERE id = _contact_id;
  END IF;

  RETURN jsonb_build_object('applied', to_jsonb(_applied), 'skipped', _skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.set_contact_fields(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_contact_fields(uuid, jsonb, text) TO authenticated, service_role;
