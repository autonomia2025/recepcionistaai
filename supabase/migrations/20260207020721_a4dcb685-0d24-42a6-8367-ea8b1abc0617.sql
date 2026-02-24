-- Improve handle_new_user to generate a proper name from email when full_name is not provided
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data ->> 'full_name'), ''),
      INITCAP(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', ' '))
    ),
    COALESCE((NEW.raw_user_meta_data ->> 'role')::app_role, 'STAFF'),
    'active'
  );
  RETURN NEW;
END;
$function$;

-- Fix existing profiles that have email as full_name
UPDATE public.profiles
SET full_name = INITCAP(REPLACE(SPLIT_PART(email, '@', 1), '.', ' '))
WHERE full_name = email OR full_name LIKE '%@%';

-- Auto-create landing_team entries for existing profiles that don't have one
INSERT INTO public.landing_team (workshop_id, profile_id, name, role, show_on_landing, sort_order)
SELECT 
  p.workshop_id,
  p.id,
  p.full_name,
  CASE p.role 
    WHEN 'ADMIN' THEN 'Administrador'
    WHEN 'STAFF' THEN 'Profesional'
    ELSE 'Equipo'
  END,
  true,
  ROW_NUMBER() OVER (PARTITION BY p.workshop_id ORDER BY p.created_at)
FROM public.profiles p
WHERE p.workshop_id IS NOT NULL
  AND p.status = 'active'
  AND p.role IN ('ADMIN', 'STAFF')
  AND NOT EXISTS (
    SELECT 1 FROM public.landing_team lt 
    WHERE lt.profile_id = p.id AND lt.workshop_id = p.workshop_id
  );