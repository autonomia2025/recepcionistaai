
DROP FUNCTION IF EXISTS public.get_workshop_profiles(uuid);

CREATE FUNCTION public.get_workshop_profiles(_workshop_id uuid)
 RETURNS TABLE(id uuid, workshop_id uuid, full_name text, email text, role app_role, status user_status, created_at timestamp with time zone, google_calendar_connected boolean, google_calendar_email text, google_connected_at timestamp with time zone, zone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.workshop_id, p.full_name, p.email, p.role, p.status, p.created_at,
         p.google_calendar_connected, p.google_calendar_email, p.google_connected_at,
         p.zone
  FROM profiles p
  WHERE p.workshop_id = _workshop_id
    AND (
      _workshop_id = get_user_workshop_id(auth.uid())
      OR is_superadmin(auth.uid())
    );
$function$;
