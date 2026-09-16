-- Apply ONLY after the frontend that reads workshops_safe and explicit profile
-- columns is published. Before that, select('*') on these tables fails.

CREATE OR REPLACE FUNCTION public.apply_safe_column_grants(_table text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  safe_columns text;
  credential_columns text[];
BEGIN
  IF _table NOT IN ('workshops', 'profiles') THEN
    RAISE EXCEPTION 'apply_safe_column_grants: unsupported table %', _table;
  END IF;

  SELECT
    string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      FILTER (WHERE NOT public.is_credential_column(column_name)),
    coalesce(
      array_agg(column_name::text ORDER BY ordinal_position)
        FILTER (WHERE public.is_credential_column(column_name)),
      '{}'
    )
  INTO safe_columns, credential_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = _table;

  -- Revoking the table privilege also revokes existing column privileges.
  EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', _table);
  EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon, authenticated', safe_columns, _table);

  IF _table = 'workshops' THEN
    PERFORM public.rebuild_workshops_safe_view();
  END IF;

  RETURN credential_columns;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_safe_column_grants(text) FROM PUBLIC, anon, authenticated;

-- New columns added later would otherwise be unreadable by the frontend.
CREATE OR REPLACE FUNCTION public.reapply_safe_column_grants_on_alter()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command record;
BEGIN
  FOR command IN
    SELECT object_identity FROM pg_event_trigger_ddl_commands() WHERE command_tag = 'ALTER TABLE'
  LOOP
    IF command.object_identity IN ('public.workshops', 'public.profiles') THEN
      PERFORM public.apply_safe_column_grants(split_part(command.object_identity, '.', 2));
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  DROP EVENT TRIGGER IF EXISTS reapply_safe_column_grants;
  CREATE EVENT TRIGGER reapply_safe_column_grants
    ON ddl_command_end
    WHEN TAG IN ('ALTER TABLE')
    EXECUTE FUNCTION public.reapply_safe_column_grants_on_alter();
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Event trigger not created (%): run SELECT public.apply_safe_column_grants(''workshops'') and (''profiles'') after every ALTER TABLE on those tables.', SQLERRM;
END;
$$;

SELECT public.apply_safe_column_grants('workshops') AS workshops_credential_columns;
SELECT public.apply_safe_column_grants('profiles') AS profiles_credential_columns;
