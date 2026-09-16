-- Feature flags per workshop. Replaces the hardcoded SOC UUID scattered across
-- the frontend and the edge functions.
ALTER TABLE public.workshops
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill keeps today's behaviour: zones stay on where the bot already asks for
-- them (zone_detection_enabled) and for SOC, off everywhere else.
UPDATE public.workshops
SET features = coalesce(features, '{}'::jsonb) || jsonb_build_object(
  'zones', coalesce(zone_detection_enabled, false) OR id = '610fb257-a649-4115-b944-21f31e7952db'::uuid,
  'commercial', false
)
WHERE NOT (features ? 'zones' AND features ? 'commercial');

CREATE OR REPLACE FUNCTION public.has_feature(_workshop_id uuid, _feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- The visibility guard lives inside the subquery so a workshop the caller
  -- cannot see returns false instead of NULL.
  SELECT coalesce((
    SELECT (w.features ->> _feature)::boolean
    FROM public.workshops w
    WHERE w.id = _workshop_id
      AND (
        auth.role() IS NULL
        OR auth.role() = 'service_role'
        OR public.is_superadmin(auth.uid())
        OR public.get_user_workshop_id(auth.uid()) = _workshop_id
      )
  ), false)
$$;

-- anon keeps EXECUTE so a policy evaluated as anon gets false instead of an error.
REVOKE ALL ON FUNCTION public.has_feature(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_feature(uuid, text) TO anon, authenticated;

-- Keep the safe view and the column grants in sync with the new column,
-- whether or not the revoke step already ran.
DO $$
BEGIN
  IF to_regprocedure('public.apply_safe_column_grants(text)') IS NOT NULL THEN
    PERFORM public.apply_safe_column_grants('workshops');
  ELSE
    PERFORM public.rebuild_workshops_safe_view();
  END IF;
END;
$$;
