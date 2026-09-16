-- Apply after the frontend that reads workshops.features is published.
-- Until then the old frontend still reads zone_detection_enabled.

-- Safety net: never drop the column while a workshop disagrees with its flag.
DO $$
DECLARE
  mismatched int;
BEGIN
  SELECT count(*) INTO mismatched
  FROM public.workshops
  WHERE coalesce(zone_detection_enabled, false)
        IS DISTINCT FROM coalesce((features ->> 'zones')::boolean, false);

  IF mismatched > 0 THEN
    RAISE EXCEPTION 'zone_detection_enabled y features->>zones difieren en % workshop(s); revisar antes de eliminar la columna', mismatched;
  END IF;
END;
$$;

-- workshops_safe selects every non-credential column, so it depends on this one.
DROP VIEW IF EXISTS public.workshops_safe;

ALTER TABLE public.workshops DROP COLUMN IF EXISTS zone_detection_enabled;

-- Rebuilds workshops_safe without the dropped column.
DO $$
BEGIN
  IF to_regprocedure('public.apply_safe_column_grants(text)') IS NOT NULL THEN
    PERFORM public.apply_safe_column_grants('workshops');
  ELSE
    PERFORM public.rebuild_workshops_safe_view();
  END IF;
END;
$$;
