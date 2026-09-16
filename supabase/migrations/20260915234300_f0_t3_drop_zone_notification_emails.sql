-- Apply after the frontend and the functions read workshop_zones.notification_email.

-- Safety net: never drop the column while an email only exists in the old place.
DO $$
DECLARE
  missing int;
BEGIN
  SELECT count(*) INTO missing
  FROM public.workshops w
  CROSS JOIN LATERAL jsonb_each_text(coalesce(w.zone_notification_emails, '{}'::jsonb)) AS legacy(key, email)
  WHERE nullif(legacy.email, '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.workshop_zones z
      WHERE z.workshop_id = w.id AND z.key = legacy.key
        AND coalesce(z.notification_email, '') = legacy.email
    );

  IF missing > 0 THEN
    RAISE EXCEPTION 'Hay % correo(s) por zona que no están migrados a workshop_zones; revisar antes de eliminar la columna', missing;
  END IF;
END;
$$;

-- workshops_safe selects every non-credential column, so it depends on this one.
DROP VIEW IF EXISTS public.workshops_safe;

ALTER TABLE public.workshops DROP COLUMN IF EXISTS zone_notification_emails;

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
